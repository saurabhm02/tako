import { getDatabase } from "./db";
import { redactSecrets } from "./redact";
import { DEFAULT_WORKFLOW_ID, type AdapterKind, type NodeKind, type WorkflowSnapshot, type WorkflowSummary } from "../../shared/types";

// The one place "which workflow is currently active" lives on the main
// side — nodes:create/connections:create/getOrCreateCurrentRun all read
// this instead of a hardcoded id, so every workflow keeps its own nodes,
// connections, runs, handoffs, and costs independent of the others. Set
// once per process at boot (DEFAULT_WORKFLOW_ID, matching the pre-existing
// single-workflow behavior) and again every time workflows:load runs —
// the same IPC call the renderer already makes on every switch.
let activeWorkflowId = DEFAULT_WORKFLOW_ID;

export function getActiveWorkflowId(): string {
  return activeWorkflowId;
}

export function setActiveWorkflowId(id: string): void {
  activeWorkflowId = id;
}

interface NodeRow {
  id: string;
  name: string;
  node_kind: string;
  agent_type: string;
  adapter_kind: string;
  working_directory: string | null;
  config_json: string;
  position_x: number;
  position_y: number;
}

interface ConnectionRow {
  id: string;
  from_node_id: string;
  to_node_id: string;
  auto_approve: number;
}

// Saving overwrites the workflow's nodes and connections in place (WF1).
// Past runs/handoffs are untouched — they reference node/connection ids,
// not a live snapshot.
//
// This upserts rather than wiping-and-reinserting: a node the user has ever
// started has node_runs/handoffs/costs rows pointing at it, so a hard
// `DELETE FROM nodes` for the whole workflow hits the foreign key the
// moment any node has real history — which rolls back the entire save
// (better-sqlite3 transactions are all-or-nothing), silently discarding
// every edit, not just that one node. Only rows no longer present in the
// snapshot are deleted, which is the "user actually removed this node"
// case — deleting one still referenced by history correctly still fails,
// exactly as directly deleting it would.
export function saveWorkflow(snapshot: WorkflowSnapshot): void {
  const db = getDatabase();
  const now = Date.now();

  const upsertWorkflow = db.transaction(() => {
    const existing = db
      .prepare("SELECT id FROM workflows WHERE id = ?")
      .get(snapshot.id);

    if (existing) {
      db.prepare(
        "UPDATE workflows SET name = ?, updated_at = ? WHERE id = ?",
      ).run(snapshot.name, now, snapshot.id);
    } else {
      db.prepare(
        "INSERT INTO workflows (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      ).run(snapshot.id, snapshot.name, now, now);
    }

    const keepNodeIds = new Set(snapshot.nodes.map((n) => n.id));
    const existingNodeIds = (
      db.prepare("SELECT id FROM nodes WHERE workflow_id = ?").all(snapshot.id) as { id: string }[]
    ).map((row) => row.id);
    for (const id of existingNodeIds) {
      if (!keepNodeIds.has(id)) db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
    }

    const keepConnectionIds = new Set(snapshot.connections.map((c) => c.id));
    const existingConnectionIds = (
      db.prepare("SELECT id FROM connections WHERE workflow_id = ?").all(snapshot.id) as { id: string }[]
    ).map((row) => row.id);
    for (const id of existingConnectionIds) {
      if (!keepConnectionIds.has(id)) db.prepare("DELETE FROM connections WHERE id = ?").run(id);
    }

    const upsertNode = db.prepare(
      `INSERT INTO nodes (id, workflow_id, name, node_kind, agent_type, adapter_kind, working_directory, config_json, position_x, position_y)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, node_kind = excluded.node_kind, agent_type = excluded.agent_type,
         adapter_kind = excluded.adapter_kind, working_directory = excluded.working_directory,
         config_json = excluded.config_json, position_x = excluded.position_x, position_y = excluded.position_y`,
    );
    for (const node of snapshot.nodes) {
      upsertNode.run(
        node.id,
        snapshot.id,
        node.name,
        node.kind,
        node.agentType,
        node.adapterKind,
        node.workingDirectory,
        JSON.stringify(node.config ?? {}),
        node.position.x,
        node.position.y,
      );
    }

    const upsertConnectionRow = db.prepare(
      `INSERT INTO connections (id, workflow_id, from_node_id, to_node_id, auto_approve, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET auto_approve = excluded.auto_approve`,
    );
    for (const connection of snapshot.connections) {
      upsertConnectionRow.run(
        connection.id,
        snapshot.id,
        connection.fromNodeId,
        connection.toNodeId,
        connection.autoApprove ? 1 : 0,
        now,
      );
    }
  });

  upsertWorkflow();
}

export function loadWorkflow(id: string): WorkflowSnapshot | null {
  const db = getDatabase();

  const workflow = db
    .prepare("SELECT id, name FROM workflows WHERE id = ?")
    .get(id) as { id: string; name: string } | undefined;

  if (!workflow) return null;

  const nodeRows = db
    .prepare("SELECT * FROM nodes WHERE workflow_id = ?")
    .all(id) as NodeRow[];

  const connectionRows = db
    .prepare("SELECT * FROM connections WHERE workflow_id = ?")
    .all(id) as ConnectionRow[];

  return {
    id: workflow.id,
    name: workflow.name,
    nodes: nodeRows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.node_kind as NodeKind,
      agentType: row.agent_type,
      adapterKind: row.adapter_kind as "terminal" | "session",
      workingDirectory: row.working_directory,
      config: JSON.parse(row.config_json) as Record<string, unknown>,
      position: { x: row.position_x, y: row.position_y },
    })),
    connections: connectionRows.map((row) => ({
      id: row.id,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      autoApprove: Boolean(row.auto_approve),
    })),
  };
}

export function listWorkflows(): WorkflowSummary[] {
  const rows = getDatabase()
    .prepare("SELECT id, name, updated_at FROM workflows ORDER BY updated_at DESC")
    .all() as { id: string; name: string; updated_at: number }[];
  return rows.map((row) => ({ id: row.id, name: row.name, updatedAt: row.updated_at }));
}

export function renameWorkflow(id: string, name: string): void {
  getDatabase().prepare("UPDATE workflows SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
}

// Same cascade shape as deleteNode below, scoped to a whole workflow
// instead of one node — handoffs/costs/node_runs all hang off run_id, not
// workflow_id directly, so they're reached via the workflow's own runs.
export function deleteWorkflow(id: string): void {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("DELETE FROM handoffs WHERE run_id IN (SELECT id FROM runs WHERE workflow_id = ?)").run(id);
    db.prepare("DELETE FROM costs WHERE run_id IN (SELECT id FROM runs WHERE workflow_id = ?)").run(id);
    db.prepare("DELETE FROM node_runs WHERE run_id IN (SELECT id FROM runs WHERE workflow_id = ?)").run(id);
    db.prepare("DELETE FROM connections WHERE workflow_id = ?").run(id);
    db.prepare("DELETE FROM nodes WHERE workflow_id = ?").run(id);
    db.prepare("DELETE FROM runs WHERE workflow_id = ?").run(id);
    db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
  })();
}

// A node/connection created on the canvas needs a row to exist right away
// (not just after Save) so runs/handoffs can reference it without breaking
// the foreign keys. The next Save reconciles everything anyway.
export function ensureWorkflowExists(workflowId: string, name: string): void {
  const now = Date.now();
  getDatabase()
    .prepare(
      `INSERT INTO workflows (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(workflowId, name, now, now);
}

export function ensureNodeExists(input: {
  id: string;
  workflowId: string;
  name: string;
  kind: NodeKind;
  agentType: string;
  adapterKind: AdapterKind;
  workingDirectory: string | null;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO nodes (id, workflow_id, name, node_kind, agent_type, adapter_kind, working_directory, config_json, position_x, position_y)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(
      input.id,
      input.workflowId,
      input.name,
      input.kind,
      input.agentType,
      input.adapterKind,
      input.workingDirectory,
      JSON.stringify(input.config ?? {}),
      input.position.x,
      input.position.y,
    );
}

export function upsertConnection(input: {
  id: string;
  workflowId: string;
  fromNodeId: string;
  toNodeId: string;
  autoApprove: boolean;
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO connections (id, workflow_id, from_node_id, to_node_id, auto_approve, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET auto_approve = excluded.auto_approve`,
    )
    .run(input.id, input.workflowId, input.fromNodeId, input.toNodeId, input.autoApprove ? 1 : 0, Date.now());
}

// A connection that ever carried even one handoff (pending, delivered,
// rejected — status doesn't matter to the FK) leaves a `handoffs` row
// referencing it; a bare DELETE then fails FOREIGN KEY constraint failed.
// Same cascade pattern deleteNode already uses below.
export function deleteConnection(id: string): void {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("DELETE FROM handoffs WHERE connection_id = ?").run(id);
    db.prepare("DELETE FROM connections WHERE id = ?").run(id);
  })();
}

// Removing a node from the canvas (nodes:dispose) previously only stopped
// its live process — the row survived in the DB, so it silently reappeared
// on the next load. This actually deletes it, including whatever
// referenced it (a node auto-starts immediately, so it almost always has
// a node_runs row by the time anyone removes it, and a hard DELETE FROM
// nodes would otherwise fail its foreign key). Deleting a node this way
// intentionally drops its own audit history too — that's the expected
// cost of "really delete," not a bug.
export function deleteNode(id: string): void {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("DELETE FROM costs WHERE node_id = ?").run(id);
    db.prepare("DELETE FROM handoffs WHERE from_node_id = ? OR to_node_id = ?").run(id, id);
    db.prepare("DELETE FROM node_runs WHERE node_id = ?").run(id);
    db.prepare("DELETE FROM connections WHERE from_node_id = ? OR to_node_id = ?").run(id, id);
    db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
  })();
}

export function setConnectionAutoApprove(id: string, autoApprove: boolean): void {
  getDatabase()
    .prepare("UPDATE connections SET auto_approve = ? WHERE id = ?")
    .run(autoApprove ? 1 : 0, id);
}

// A node's live output/session identity, kept separate from the canvas
// snapshot (`saveWorkflow`/`loadWorkflow`) on purpose — that snapshot is
// entirely renderer-driven and only written on an explicit Save, which
// would silently wipe this on every save if it lived on WorkflowSnapshot/
// NodeRecord instead. NodeManager reads/writes it directly so a node's
// conversation survives an app restart whether or not the user ever
// clicked Save.
export function getNodeRuntimeState(nodeId: string): { lastOutputText: string; sessionRef: string | null } {
  const row = getDatabase()
    .prepare("SELECT last_output_text, session_ref FROM nodes WHERE id = ?")
    .get(nodeId) as { last_output_text: string; session_ref: string | null } | undefined;
  return row ? { lastOutputText: row.last_output_text, sessionRef: row.session_ref } : { lastOutputText: "", sessionRef: null };
}

export function saveNodeRuntimeState(nodeId: string, lastOutputText: string, sessionRef: string | null): void {
  getDatabase()
    .prepare("UPDATE nodes SET last_output_text = ?, session_ref = ? WHERE id = ?")
    .run(redactSecrets(lastOutputText), sessionRef, nodeId);
}
