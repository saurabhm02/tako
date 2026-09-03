import { randomUUID } from "node:crypto";
import { getDatabase } from "./db";
import { redactSecrets } from "./redact";
import type { FileChange } from "../git/codeChanges";
import type { CodeChangeDetail, CodeChangeFile, CodeChangeSummaryRow } from "../../shared/types";

// Returns the summary row (never the diff text/file list — same "summary
// is cheap, detail is fetched lazily" split as listCodeChangeSummariesForRow
// below) so the caller can broadcast it live without a second query. Code
// Workspace v2's agent-node "View changes" affordance is the only consumer
// of this return value; existing callers that ignored it are unaffected.
export function insertCodeChange(input: {
  runId: string;
  nodeId: string;
  agentType: string;
  workingDirectory: string;
  beforeTree: string | null;
  afterTree: string | null;
  files: FileChange[];
  insertions: number;
  deletions: number;
  diffText: string;
  truncated: boolean;
  concurrentRisk: boolean;
}): CodeChangeSummaryRow {
  const id = randomUUID();
  const createdAt = Date.now();
  getDatabase()
    .prepare(
      `INSERT INTO code_changes
        (id, run_id, node_id, working_directory, before_tree, after_tree, files_changed, insertions, deletions, files_json, diff_text, truncated, concurrent_risk, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId,
      input.nodeId,
      input.workingDirectory,
      input.beforeTree,
      input.afterTree,
      input.files.length,
      input.insertions,
      input.deletions,
      JSON.stringify(input.files),
      redactSecrets(input.diffText),
      input.truncated ? 1 : 0,
      input.concurrentRisk ? 1 : 0,
      createdAt,
    );
  return {
    id,
    nodeId: input.nodeId,
    agentType: input.agentType,
    filesChanged: input.files.length,
    insertions: input.insertions,
    deletions: input.deletions,
    truncated: input.truncated,
    concurrentRisk: input.concurrentRisk,
    createdAt,
  };
}

interface SummaryRow {
  id: string;
  node_id: string;
  agent_type: string;
  name: string;
  files_changed: number;
  insertions: number;
  deletions: number;
  truncated: number;
  concurrent_risk: number;
  created_at: number;
}

// Summary only — no diff_text/files_json, so listing a run's history never
// pulls potentially-large diff blobs over IPC just to render the log.
// n.name (the same join already used for agent_type) gives the viewer the
// node's real user-given name ("Apollo"), not just its agent type.
export function listCodeChangeSummariesForRun(runId: string): CodeChangeSummaryRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT cc.id, cc.node_id, n.agent_type, n.name, cc.files_changed, cc.insertions, cc.deletions, cc.truncated, cc.concurrent_risk, cc.created_at
       FROM code_changes cc JOIN nodes n ON n.id = cc.node_id
       WHERE cc.run_id = ?`,
    )
    .all(runId) as SummaryRow[];
  return rows.map((row) => ({
    id: row.id,
    nodeId: row.node_id,
    agentType: row.agent_type,
    nodeName: row.name,
    filesChanged: row.files_changed,
    insertions: row.insertions,
    deletions: row.deletions,
    truncated: Boolean(row.truncated),
    concurrentRisk: Boolean(row.concurrent_risk),
    createdAt: row.created_at,
  }));
}

// Fetched only when the user actually clicks "View changes" — the one
// place the (potentially large, capped) diff text is ever sent over IPC.
export function getCodeChangeDetail(id: string): CodeChangeDetail | null {
  const row = getDatabase()
    .prepare("SELECT files_json, diff_text, truncated FROM code_changes WHERE id = ?")
    .get(id) as { files_json: string; diff_text: string; truncated: number } | undefined;
  if (!row) return null;
  return {
    files: JSON.parse(row.files_json) as CodeChangeFile[],
    diffText: row.diff_text,
    truncated: Boolean(row.truncated),
  };
}
