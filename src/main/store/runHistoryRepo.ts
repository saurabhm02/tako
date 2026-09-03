import { getDatabase } from "./db";
import { listCodeChangeSummariesForRun } from "./codeChangesRepo";
import { getCostSummaryForRun } from "./costsRepo";
import type { HandoffStatus, NodeStatus, RunDetail, RunEvent, RunSummary } from "../../shared/types";

interface RunRow {
  id: string;
  workflow_id: string;
  workflow_name: string;
  started_at: number;
  ended_at: number | null;
  status: string;
  hop_limit_reached_at: number | null;
}

function runFromRow(row: RunRow): RunSummary {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    hopLimitReachedAt: row.hop_limit_reached_at,
  };
}

// A run's displayed status/ended_at is derived live from its node_runs,
// never trusted from the stored runs.status column — that column is set
// once at INSERT and would otherwise go stale the instant a node
// starts/stops/crashes without anyone updating this row. A run is
// "running" iff it has a node_run still open (ended_at IS NULL); its
// ended_at is the latest close time once every node_run has closed.
const RUN_SELECT = `
  SELECT r.id, r.workflow_id, w.name as workflow_name, r.started_at,
    CASE WHEN EXISTS (SELECT 1 FROM node_runs nr WHERE nr.run_id = r.id AND nr.ended_at IS NULL)
      THEN NULL
      ELSE (SELECT MAX(nr2.ended_at) FROM node_runs nr2 WHERE nr2.run_id = r.id)
    END as ended_at,
    CASE WHEN EXISTS (SELECT 1 FROM node_runs nr WHERE nr.run_id = r.id AND nr.ended_at IS NULL)
      THEN 'running'
      ELSE 'ended'
    END as status,
    r.hop_limit_reached_at
  FROM runs r JOIN workflows w ON w.id = r.workflow_id
`;

export function listRuns(): RunSummary[] {
  // rowid as a tiebreaker keeps ordering deterministic when two runs start
  // within the same millisecond (started_at alone isn't unique).
  const rows = getDatabase()
    .prepare(`${RUN_SELECT} ORDER BY r.started_at DESC, r.rowid DESC`)
    .all() as RunRow[];
  return rows.map(runFromRow);
}

interface NodeRunRow {
  node_id: string;
  agent_type: string;
  started_at: number;
  ended_at: number | null;
  status: NodeStatus;
  final_output_text: string | null;
}

interface HandoffRow {
  id: string;
  from_node_id: string;
  from_agent_type: string;
  to_node_id: string;
  to_agent_type: string;
  payload_text: string;
  edited: number;
  auto_approved: number;
  status: HandoffStatus;
  created_at: number;
  resolved_at: number | null;
}

function eventTimestamp(event: RunEvent): number {
  return event.kind === "node_run" ? event.startedAt : event.createdAt;
}

function codeChangeEvent(row: ReturnType<typeof listCodeChangeSummariesForRun>[number]): RunEvent {
  return { kind: "code_change", ...row };
}

// §15: no separate audit log table — this is the ordered union of
// node_runs and handoffs for one run, joined by timestamp.
export function getRunDetail(runId: string): RunDetail | null {
  const db = getDatabase();
  const runRow = db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(runId) as RunRow | undefined;
  if (!runRow) return null;

  const nodeRunRows = db
    .prepare(
      `SELECT nr.node_id, n.agent_type, nr.started_at, nr.ended_at, nr.status, nr.final_output_text
       FROM node_runs nr JOIN nodes n ON n.id = nr.node_id
       WHERE nr.run_id = ?`,
    )
    .all(runId) as NodeRunRow[];

  const handoffRows = db
    .prepare(
      `SELECT h.id, h.from_node_id, fn.agent_type as from_agent_type, h.to_node_id, tn.agent_type as to_agent_type,
              h.payload_text, h.edited, h.auto_approved, h.status, h.created_at, h.resolved_at
       FROM handoffs h
       JOIN nodes fn ON fn.id = h.from_node_id
       JOIN nodes tn ON tn.id = h.to_node_id
       WHERE h.run_id = ?`,
    )
    .all(runId) as HandoffRow[];

  const events: RunEvent[] = [
    ...nodeRunRows.map(
      (row): RunEvent => ({
        kind: "node_run",
        nodeId: row.node_id,
        agentType: row.agent_type,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        status: row.status,
        finalOutputText: row.final_output_text,
      }),
    ),
    ...handoffRows.map(
      (row): RunEvent => ({
        kind: "handoff",
        handoffId: row.id,
        fromNodeId: row.from_node_id,
        fromAgentType: row.from_agent_type,
        toNodeId: row.to_node_id,
        toAgentType: row.to_agent_type,
        payloadText: row.payload_text,
        edited: Boolean(row.edited),
        autoApproved: Boolean(row.auto_approved),
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      }),
    ),
    ...listCodeChangeSummariesForRun(runId).map(codeChangeEvent),
  ].sort((a, b) => eventTimestamp(a) - eventTimestamp(b));

  return { run: runFromRow(runRow), events, runCost: getCostSummaryForRun(runId) };
}
