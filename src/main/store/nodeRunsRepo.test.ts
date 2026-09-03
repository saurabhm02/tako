import { beforeEach, describe, expect, test } from "bun:test";
import { closeDatabaseForTests, initDatabase } from "./db";
import { getOrCreateCurrentRun, resetCurrentRunForTests } from "./runsRepo";
import { ensureNodeExists, ensureWorkflowExists } from "./workflowsRepo";
import { closeOrphanedNodeRuns, finishNodeRun, insertNodeRun } from "./nodeRunsRepo";
import { listRuns } from "./runHistoryRepo";
import { DEFAULT_WORKFLOW_ID } from "../../shared/types";

function makeNode(id: string) {
  ensureWorkflowExists(DEFAULT_WORKFLOW_ID, "My Workflow");
  ensureNodeExists({
    id,
    workflowId: DEFAULT_WORKFLOW_ID,
    name: id,
    kind: "agent",
    agentType: "claude-code",
    adapterKind: "terminal",
    workingDirectory: null,
    config: {},
    position: { x: 0, y: 0 },
  });
}

beforeEach(() => {
  closeDatabaseForTests();
  initDatabase(":memory:");
  resetCurrentRunForTests();
});

describe("closeOrphanedNodeRuns", () => {
  // Simulates the one case this exists for: the app was killed/crashed
  // while a node was mid-run, so its node_runs row never got an ended_at.
  // NodeManager's registry is provably empty on the fresh process that
  // calls this at startup — no live adapter can possibly own that row.
  test("closes a node_run left open by a previous process, so it stops showing as running", () => {
    makeNode("a");
    const runId = getOrCreateCurrentRun();
    insertNodeRun(runId, "a");
    expect(listRuns().find((r) => r.id === runId)!.status).toBe("running");

    closeOrphanedNodeRuns();

    expect(listRuns().find((r) => r.id === runId)!.status).toBe("ended");
  });

  test("leaves an already-finished node_run's ended_at and status completely unchanged", () => {
    makeNode("a");
    const runId = getOrCreateCurrentRun();
    const nodeRunId = insertNodeRun(runId, "a");
    finishNodeRun(nodeRunId, "handoff_ready", "done");
    const before = listRuns().find((r) => r.id === runId)!;

    closeOrphanedNodeRuns();

    const after = listRuns().find((r) => r.id === runId)!;
    expect(after.endedAt).toBe(before.endedAt);
    expect(after.status).toBe(before.status);
  });
});
