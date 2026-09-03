import { randomUUID } from "node:crypto";
import { getDatabase } from "./db";
import { ensureWorkflowExists, getActiveWorkflowId } from "./workflowsRepo";

// One run per (app session, active workflow), created the first time it's
// needed (CM1: every node starts fresh each run, which already matches
// NodeManager's registry starting empty on every launch). A full run
// lifecycle with explicit start/end belongs to a later epic.
let currentRunId: string | null = null;
// Which workflow the cached currentRunId actually belongs to — switching
// the active workflow (workflows:load) makes the cached run stale without
// needing a separate "reset" call from the IPC layer; this just notices on
// the next read.
let currentRunWorkflowId: string | null = null;

export function getOrCreateCurrentRun(): string {
  const workflowId = getActiveWorkflowId();
  if (currentRunId && currentRunWorkflowId === workflowId) return currentRunId;

  ensureWorkflowExists(workflowId, "My Workflow"); // insurance only, ON CONFLICT DO NOTHING

  const id = randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO runs (id, workflow_id, started_at, status) VALUES (?, ?, ?, ?)`,
    )
    .run(id, workflowId, Date.now(), "running");
  currentRunId = id;
  currentRunWorkflowId = workflowId;
  return id;
}

// Read-only — unlike getOrCreateCurrentRun, never creates a run as a side
// effect. For read paths (like a cost summary) that shouldn't conjure a
// run into existence just by being asked.
export function getCurrentRunId(): string | null {
  return currentRunId;
}

export function countApprovedHandoffsInRun(runId: string): number {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) as count FROM handoffs WHERE run_id = ? AND status IN ('queued', 'delivered')`,
    )
    .get(runId) as { count: number };
  return row.count;
}

// Only the first time the limit is crossed — the timestamp marks when it
// happened, not how many times it's been checked since.
export function markHopLimitReachedOnce(runId: string): void {
  getDatabase()
    .prepare(
      `UPDATE runs SET hop_limit_reached_at = ? WHERE id = ? AND hop_limit_reached_at IS NULL`,
    )
    .run(Date.now(), runId);
}

// Test-only: forget the cached run so the next call starts a fresh one.
export function resetCurrentRunForTests(): void {
  currentRunId = null;
  currentRunWorkflowId = null;
}
