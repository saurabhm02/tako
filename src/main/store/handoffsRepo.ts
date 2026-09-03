import { randomUUID } from "node:crypto";
import { getDatabase } from "./db";
import { redactSecrets } from "./redact";
import { getActiveWorkflowId } from "./workflowsRepo";
import type { HandoffStatus } from "../../shared/types";

export interface HandoffRow {
  id: string;
  runId: string;
  connectionId: string;
  fromNodeId: string;
  toNodeId: string;
  payloadText: string;
  edited: boolean;
  autoApproved: boolean;
  status: HandoffStatus;
  createdAt: number;
}

interface Row {
  id: string;
  run_id: string;
  connection_id: string;
  from_node_id: string;
  to_node_id: string;
  payload_text: string;
  edited: number;
  auto_approved: number;
  status: HandoffStatus;
  created_at: number;
}

function fromRow(row: Row): HandoffRow {
  return {
    id: row.id,
    runId: row.run_id,
    connectionId: row.connection_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    payloadText: row.payload_text,
    edited: Boolean(row.edited),
    autoApproved: Boolean(row.auto_approved),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function insertHandoff(input: {
  runId: string;
  connectionId: string;
  fromNodeId: string;
  toNodeId: string;
  payloadText: string;
  autoApproved: boolean;
}): HandoffRow {
  const id = randomUUID();
  const createdAt = Date.now();
  const payloadText = redactSecrets(input.payloadText);
  getDatabase()
    .prepare(
      `INSERT INTO handoffs (id, run_id, connection_id, from_node_id, to_node_id, payload_text, auto_approved, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(id, input.runId, input.connectionId, input.fromNodeId, input.toNodeId, payloadText, input.autoApproved ? 1 : 0, createdAt);

  return {
    id,
    runId: input.runId,
    connectionId: input.connectionId,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    payloadText,
    edited: false,
    autoApproved: input.autoApproved,
    status: "pending",
    createdAt,
  };
}

export function updateHandoffPayload(id: string, payloadText: string): void {
  getDatabase()
    .prepare("UPDATE handoffs SET payload_text = ?, edited = 1 WHERE id = ?")
    .run(redactSecrets(payloadText), id);
}

// "queued" is still in flight, so it has no resolution time yet — every
// other status is a final outcome and gets stamped.
export function updateHandoffStatus(id: string, status: HandoffStatus): void {
  const resolvedAt = status === "queued" ? null : Date.now();
  getDatabase()
    .prepare("UPDATE handoffs SET status = ?, resolved_at = ? WHERE id = ?")
    .run(status, resolvedAt, id);
}

export function getHandoff(id: string): HandoffRow | null {
  const row = getDatabase().prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

// Scoped to the active workflow via its runs (handoffs.run_id -> runs.id ->
// runs.workflow_id) — same idea runsRepo.ts already applies to
// currentRunId. Unscoped, this returned every pending handoff system-wide,
// so switching workflows left the Approval Sidebar showing stale cards
// from whichever workflow was active when they were first fetched (real
// bug, not just staleness — CanvasApp never re-derives this list from a
// workflow-scoped source on its own).
export function listPendingHandoffs(): HandoffRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT h.* FROM handoffs h
       JOIN runs r ON r.id = h.run_id
       WHERE h.status = 'pending' AND r.workflow_id = ?
       ORDER BY h.created_at ASC`,
    )
    .all(getActiveWorkflowId()) as Row[];
  return rows.map(fromRow);
}

// Call once at real app startup, right after the database opens — same
// justification as closeOrphanedNodeRuns: HandoffQueue is an in-memory Map
// that's always empty on a fresh process, so a handoff still 'queued' at
// this exact moment cannot belong to any live queue; it's stuck from a
// previous process that quit before its destination node freed up. Reset
// to 'pending' (not delivered, not lost) so it resurfaces in the Approval
// Sidebar for the user to re-approve.
export function resetQueuedHandoffsToPending(): void {
  getDatabase()
    .prepare("UPDATE handoffs SET status = 'pending', resolved_at = NULL WHERE status = 'queued'")
    .run();
}
