import { getDatabase } from "./db";
import type {
  NodeRun,
  RuntimeHandoff,
  WorkflowRun,
  WorkflowRuntimeEvent,
} from "../../shared/types";
import type { IWorkflowRunStore } from "../runtime/types";

/**
 * SQLite implementation of IWorkflowRunStore for persisting workflow executions and events locally.
 */
export class SqliteWorkflowRunStore implements IWorkflowRunStore {
  constructor() {
    this.reconcileInterruptedRuns();
  }

  /**
   * Reconciles any workflow runs or node runs that were left in 'running' state if the app was terminated.
   */
  private reconcileInterruptedRuns(): void {
    try {
      const db = getDatabase();
      const now = Date.now();
      db.prepare(`UPDATE runs SET status = 'cancelled', ended_at = ? WHERE status = 'running'`).run(now);
      db.prepare(`UPDATE node_runs SET status = 'cancelled', ended_at = ? WHERE status = 'running'`).run(now);
    } catch {
      // Best effort on startup
    }
  }

  saveRun(run: WorkflowRun): void {
    const db = getDatabase();

    // Ensure workflow exists in workflows table
    db.prepare(`INSERT INTO workflows (id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`)
      .run(run.workflowId, run.workflowName || "My Workflow", run.startedAt, Date.now());

    // Upsert run record
    db.prepare(
      `INSERT INTO runs (id, workflow_id, started_at, ended_at, status)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET ended_at = excluded.ended_at, status = excluded.status`,
    ).run(run.executionId, run.workflowId, run.startedAt, run.completedAt, run.status);

    // Upsert node runs
    const insertNodeRunStmt = db.prepare(
      `INSERT INTO node_runs (id, run_id, node_id, started_at, ended_at, status, final_output_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET ended_at = excluded.ended_at, status = excluded.status, final_output_text = excluded.final_output_text`,
    );

    for (const [nodeId, nr] of Object.entries(run.nodeRuns)) {
      // Ensure node exists in nodes table (foreign key)
      db.prepare(
        `INSERT INTO nodes (id, workflow_id, name, agent_type, adapter_kind, position_x, position_y)
         VALUES (?, ?, ?, ?, 'terminal', 0, 0)
         ON CONFLICT DO NOTHING`,
      ).run(nodeId, run.workflowId, nr.nodeName, nr.agentType);

      const nodeRunId = `${run.executionId}:${nodeId}`;
      insertNodeRunStmt.run(
        nodeRunId,
        run.executionId,
        nodeId,
        nr.startedAt ?? run.startedAt,
        nr.completedAt,
        nr.status,
        nr.output?.outputText ?? null,
      );
    }
  }

  saveEvent(event: WorkflowRuntimeEvent): void {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO runtime_events (id, execution_id, workflow_id, event_type, timestamp, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(event.id, event.executionId, event.workflowId, event.type, event.timestamp, JSON.stringify(event));
  }

  saveHandoff(handoff: RuntimeHandoff): void {
    const db = getDatabase();
    // Save to runtime_events or handoffs table
    db.prepare(
      `INSERT INTO handoffs (id, run_id, connection_id, from_node_id, to_node_id, payload_text, status, created_at)
       VALUES (?, ?, '', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
    ).run(
      handoff.id,
      handoff.executionId,
      handoff.fromNodeId,
      handoff.toNodeId,
      handoff.sourceOutput,
      handoff.status,
      handoff.timestamp,
    );
  }

  getRun(executionId: string): WorkflowRun | null {
    const db = getDatabase();
    const runRow = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(executionId) as
      | { id: string; workflow_id: string; started_at: number; ended_at: number | null; status: string }
      | undefined;

    if (!runRow) return null;

    const nodeRunRows = db.prepare(`SELECT * FROM node_runs WHERE run_id = ?`).all(executionId) as Array<{
      id: string;
      node_id: string;
      started_at: number;
      ended_at: number | null;
      status: string;
      final_output_text: string | null;
    }>;

    const eventRows = db.prepare(`SELECT * FROM runtime_events WHERE execution_id = ? ORDER BY timestamp ASC`).all(executionId) as Array<{
      payload_json: string;
    }>;

    const handoffRows = db.prepare(`SELECT * FROM handoffs WHERE run_id = ?`).all(executionId) as Array<{
      id: string;
      from_node_id: string;
      to_node_id: string;
      payload_text: string;
      status: string;
      created_at: number;
    }>;

    const nodeRuns: Record<string, NodeRun> = {};
    for (const nr of nodeRunRows) {
      nodeRuns[nr.node_id] = {
        nodeId: nr.node_id,
        nodeName: nr.node_id,
        agentType: "agent",
        status: nr.status as NodeRun["status"],
        startedAt: nr.started_at,
        completedAt: nr.ended_at,
        input: null,
        output: nr.final_output_text ? { outputText: nr.final_output_text } : null,
        error: null,
        sessionRef: null,
      };
    }

    const events: WorkflowRuntimeEvent[] = eventRows.map((r) => JSON.parse(r.payload_json) as WorkflowRuntimeEvent);
    const handoffs: RuntimeHandoff[] = handoffRows.map((h) => ({
      id: h.id,
      executionId,
      fromNodeId: h.from_node_id,
      toNodeId: h.to_node_id,
      sourceOutput: h.payload_text,
      timestamp: h.created_at,
      status: h.status as RuntimeHandoff["status"],
    }));

    return {
      executionId: runRow.id,
      workflowId: runRow.workflow_id,
      workflowName: "My Workflow",
      status: runRow.status as WorkflowRun["status"],
      startedAt: runRow.started_at,
      completedAt: runRow.ended_at,
      nodeRuns,
      handoffs,
      events,
      error: null,
    };
  }

  listRuns(workflowId?: string): WorkflowRun[] {
    const db = getDatabase();
    const query = workflowId ? `SELECT id FROM runs WHERE workflow_id = ? ORDER BY started_at DESC` : `SELECT id FROM runs ORDER BY started_at DESC`;
    const rows = (workflowId ? db.prepare(query).all(workflowId) : db.prepare(query).all()) as Array<{ id: string }>;
    return rows.map((r) => this.getRun(r.id)!).filter(Boolean);
  }
}

/**
 * In-memory implementation of IWorkflowRunStore for testing and transient runtime sessions.
 */
export class InMemoryWorkflowRunStore implements IWorkflowRunStore {
  private readonly runs = new Map<string, WorkflowRun>();
  private readonly eventsByRun = new Map<string, WorkflowRuntimeEvent[]>();
  private readonly handoffsByRun = new Map<string, RuntimeHandoff[]>();

  saveRun(run: WorkflowRun): void {
    this.runs.set(run.executionId, JSON.parse(JSON.stringify(run)));
  }

  saveEvent(event: WorkflowRuntimeEvent): void {
    if (!this.eventsByRun.has(event.executionId)) {
      this.eventsByRun.set(event.executionId, []);
    }
    this.eventsByRun.get(event.executionId)!.push(event);
  }

  saveHandoff(handoff: RuntimeHandoff): void {
    if (!this.handoffsByRun.has(handoff.executionId)) {
      this.handoffsByRun.set(handoff.executionId, []);
    }
    this.handoffsByRun.get(handoff.executionId)!.push(handoff);
  }

  getRun(executionId: string): WorkflowRun | null {
    const run = this.runs.get(executionId);
    if (!run) return null;
    return JSON.parse(JSON.stringify(run));
  }

  listRuns(workflowId?: string): WorkflowRun[] {
    const all = Array.from(this.runs.values());
    if (workflowId) {
      return all.filter((r) => r.workflowId === workflowId);
    }
    return all;
  }
}
