import { randomUUID } from "node:crypto";
import { getDatabase } from "./db";
import { redactSecrets } from "./redact";
import type { NodeStatus } from "../../shared/types";

export function insertNodeRun(runId: string, nodeId: string): string {
  const id = randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO node_runs (id, run_id, node_id, started_at, status) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, runId, nodeId, Date.now(), "idle");
  return id;
}

export function finishNodeRun(nodeRunId: string, status: NodeStatus, finalOutputText: string): void {
  getDatabase()
    .prepare(
      `UPDATE node_runs SET ended_at = ?, status = ?, final_output_text = ? WHERE id = ?`,
    )
    .run(Date.now(), status, redactSecrets(finalOutputText), nodeRunId);
}

// Call exactly once at real app startup, right after the database opens —
// NodeManager's registry is always empty on a fresh process (CM1: no
// PID-reattachment, every node starts fresh), so any node_runs row still
// open at that moment cannot belong to a live process; it's a previous
// process's run that never got to close (killed, crashed, force-quit).
// This is not a guess and not a periodic sweep — it runs once, at the one
// moment the "no process can possibly own this row" fact is guaranteed.
export function closeOrphanedNodeRuns(): void {
  getDatabase()
    .prepare(`UPDATE node_runs SET ended_at = ?, status = 'error' WHERE ended_at IS NULL`)
    .run(Date.now());
}
