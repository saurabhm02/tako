import { describe, expect, test } from "bun:test";
import { initDatabase, closeDatabaseForTests } from "./db";

describe("db smoke test", () => {
  test("opens an in-memory database and creates the schema", () => {
    const db = initDatabase(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toContain("handoffs");
    closeDatabaseForTests();
  });

  test("creates the indexes the hot queries rely on", () => {
    const db = initDatabase(":memory:");
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_handoffs_run_id");
    expect(names).toContain("idx_handoffs_status");
    expect(names).toContain("idx_node_runs_run_id");
    expect(names).toContain("idx_costs_run_id");
    closeDatabaseForTests();
  });
});
