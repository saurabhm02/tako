import { mock } from "bun:test";
import { Database as BunSqliteDatabase } from "bun:sqlite";

// better-sqlite3 doesn't run under Bun at all (Bun's own error points
// people at bun:sqlite instead). Production code and the real Electron
// app still use the real better-sqlite3 — this substitution only exists
// inside `bun test`. The two libraries' APIs line up for everything this
// project uses (prepare/get/all/run/exec/transaction/close).
mock.module("better-sqlite3", () => ({
  default: BunSqliteDatabase,
}));

// The real `electron` module only resolves to its actual API when run
// through the Electron binary itself — under `bun test` it's just a path
// string. A couple of adapters (pi.ts, codexAppServer.ts) and some IPC
// registration modules (gitIpc.ts) import small pieces of it at module
// scope, so any test that touches them needs a stub.
mock.module("electron", () => ({
  app: { getPath: () => "/tmp" },
  shell: { openExternal: async () => {} },
  ipcMain: { handle: () => {} },
}));
