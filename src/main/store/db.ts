import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Schema per docs/07-architecture.md §13. `direction` is intentionally absent
// from `connections` — see ADR-0005 (every connection is a single directed
// edge; two-way is two rows, not a connection-level property).
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    workflow_type TEXT NOT NULL DEFAULT 'canvas',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    name TEXT NOT NULL DEFAULT '',
    node_kind TEXT NOT NULL DEFAULT 'agent',
    agent_type TEXT NOT NULL,
    adapter_kind TEXT NOT NULL,
    working_directory TEXT,
    config_json TEXT NOT NULL DEFAULT '{}',
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    last_output_text TEXT NOT NULL DEFAULT '',
    session_ref TEXT,
    role_id TEXT
  );

  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    from_node_id TEXT NOT NULL REFERENCES nodes(id),
    to_node_id TEXT NOT NULL REFERENCES nodes(id),
    auto_approve INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL,
    hop_limit_reached_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS node_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    node_id TEXT NOT NULL REFERENCES nodes(id),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL,
    final_output_text TEXT
  );

  CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    connection_id TEXT NOT NULL REFERENCES connections(id),
    from_node_id TEXT NOT NULL REFERENCES nodes(id),
    to_node_id TEXT NOT NULL REFERENCES nodes(id),
    payload_text TEXT NOT NULL,
    edited INTEGER NOT NULL DEFAULT 0,
    auto_approved INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS costs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    node_id TEXT NOT NULL REFERENCES nodes(id),
    tokens_or_units INTEGER,
    dollar_cost REAL,
    unknown INTEGER NOT NULL DEFAULT 0,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credential_refs (
    service_id TEXT PRIMARY KEY,
    keychain_key TEXT NOT NULL
  );

  -- One row per agent turn that actually changed files (git repos only,
  -- v1) — before/after are git tree object ids from a shadow-index
  -- snapshot, never a commit/stash, so the user's real index/working tree
  -- is never touched. A turn with no file changes gets no row at all.
  CREATE TABLE IF NOT EXISTS code_changes (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    node_id TEXT NOT NULL REFERENCES nodes(id),
    working_directory TEXT NOT NULL,
    before_tree TEXT,
    after_tree TEXT,
    files_changed INTEGER NOT NULL,
    insertions INTEGER NOT NULL,
    deletions INTEGER NOT NULL,
    files_json TEXT NOT NULL,
    diff_text TEXT NOT NULL,
    truncated INTEGER NOT NULL DEFAULT 0,
    concurrent_risk INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runtime_events (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES runs(id),
    workflow_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    payload_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_handoffs_run_id ON handoffs(run_id);
  CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status);
  CREATE INDEX IF NOT EXISTS idx_node_runs_run_id ON node_runs(run_id);
  CREATE INDEX IF NOT EXISTS idx_costs_run_id ON costs(run_id);
  CREATE INDEX IF NOT EXISTS idx_code_changes_run_id ON code_changes(run_id);
  CREATE INDEX IF NOT EXISTS idx_runtime_events_exec ON runtime_events(execution_id);
`;

let db: Database.Database | null = null;

// Takes a path rather than resolving Electron's userData folder itself —
// this file has no reason to know about Electron at all, and staying
// plain lets tests open a throwaway `:memory:` database. main.ts resolves
// the real on-disk path and passes it in.
export function initDatabase(dbPath: string): Database.Database {
  if (db) return db;

  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);

  return db;
}

// `CREATE TABLE IF NOT EXISTS` doesn't add columns to a table that already
// exists on disk from an earlier version of the schema — this adds any
// missing ones so older databases pick up new node fields without a reset.
function migrate(db: Database.Database): void {
  const columns = (db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!columns.includes("name")) {
    db.exec("ALTER TABLE nodes ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.includes("node_kind")) {
    db.exec("ALTER TABLE nodes ADD COLUMN node_kind TEXT NOT NULL DEFAULT 'agent'");
  }
  if (!columns.includes("last_output_text")) {
    db.exec("ALTER TABLE nodes ADD COLUMN last_output_text TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.includes("session_ref")) {
    db.exec("ALTER TABLE nodes ADD COLUMN session_ref TEXT");
  }
  if (!columns.includes("role_id")) {
    db.exec("ALTER TABLE nodes ADD COLUMN role_id TEXT");
  }

  const wfColumns = (db.prepare("PRAGMA table_info(workflows)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!wfColumns.includes("workflow_type")) {
    db.exec("ALTER TABLE workflows ADD COLUMN workflow_type TEXT NOT NULL DEFAULT 'canvas'");
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized — call initDatabase() first");
  }
  return db;
}

// Test-only: close and forget the current connection so the next
// initDatabase() call starts a genuinely fresh database.
export function closeDatabaseForTests(): void {
  db?.close();
  db = null;
}
