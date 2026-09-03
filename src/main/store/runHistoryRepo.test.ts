import { beforeEach, describe, expect, test } from "bun:test";
import { closeDatabaseForTests, initDatabase } from "./db";
import { getOrCreateCurrentRun, markHopLimitReachedOnce, resetCurrentRunForTests } from "./runsRepo";
import { ensureNodeExists, ensureWorkflowExists, upsertConnection } from "./workflowsRepo";
import { insertNodeRun, finishNodeRun } from "./nodeRunsRepo";
import { insertHandoff, updateHandoffStatus } from "./handoffsRepo";
import { getRunDetail, listRuns } from "./runHistoryRepo";
import { DEFAULT_WORKFLOW_ID } from "../../shared/types";

function makeNode(id: string, agentType: string) {
  ensureWorkflowExists(DEFAULT_WORKFLOW_ID, "My Workflow");
  ensureNodeExists({
    id,
    workflowId: DEFAULT_WORKFLOW_ID,
    name: id,
    kind: "agent",
    agentType,
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

describe("runHistoryRepo", () => {
  test("listRuns returns runs newest-first with their workflow name", () => {
    const firstRunId = getOrCreateCurrentRun();
    resetCurrentRunForTests();
    const secondRunId = getOrCreateCurrentRun();

    const runs = listRuns();

    expect(runs.map((r) => r.id)).toEqual([secondRunId, firstRunId]);
    expect(runs[0].workflowName).toBe("My Workflow");
  });

  test("getRunDetail returns null for an unknown run", () => {
    expect(getRunDetail("does-not-exist")).toBeNull();
  });

  test("getRunDetail merges node_runs and handoffs into one timestamp-ordered log", () => {
    makeNode("a", "claude-code");
    makeNode("b", "pi");
    upsertConnection({ id: "conn-1", workflowId: DEFAULT_WORKFLOW_ID, fromNodeId: "a", toNodeId: "b", autoApprove: false });
    const runId = getOrCreateCurrentRun();

    const nodeRunId = insertNodeRun(runId, "a");
    const handoff = insertHandoff({
      runId,
      connectionId: "conn-1",
      fromNodeId: "a",
      toNodeId: "b",
      payloadText: "the answer is 4",
      autoApproved: false,
    });
    updateHandoffStatus(handoff.id, "delivered");
    finishNodeRun(nodeRunId, "handoff_ready", "the answer is 4");

    const detail = getRunDetail(runId)!;

    expect(detail.run.id).toBe(runId);
    expect(detail.events).toHaveLength(2);

    const [nodeEvent, handoffEvent] = detail.events;
    expect(nodeEvent).toMatchObject({ kind: "node_run", nodeId: "a", agentType: "claude-code", status: "handoff_ready" });
    expect(handoffEvent).toMatchObject({
      kind: "handoff",
      fromAgentType: "claude-code",
      toAgentType: "pi",
      payloadText: "the answer is 4",
      status: "delivered",
    });
  });

  test("getRunDetail surfaces the hop-limit timestamp when it was reached", () => {
    const runId = getOrCreateCurrentRun();
    markHopLimitReachedOnce(runId);

    const detail = getRunDetail(runId)!;

    expect(detail.run.hopLimitReachedAt).not.toBeNull();
  });

  // The run's own `status`/`ended_at` columns are never trusted for display
  // (see runHistoryRepo.ts's RUN_SELECT) — status is derived live from
  // whether any of its node_runs is still open, so it can never go stale
  // independently of the node_runs that actually define it.
  test("a run with a node_run still open shows as running, with no ended_at", () => {
    makeNode("a", "claude-code");
    const runId = getOrCreateCurrentRun();
    insertNodeRun(runId, "a");

    const run = listRuns().find((r) => r.id === runId)!;

    expect(run.status).toBe("running");
    expect(run.endedAt).toBeNull();
  });

  test("a run whose only node_run has ended shows as ended, with a real ended_at", () => {
    makeNode("a", "claude-code");
    const runId = getOrCreateCurrentRun();
    const nodeRunId = insertNodeRun(runId, "a");
    finishNodeRun(nodeRunId, "idle", "");

    const run = listRuns().find((r) => r.id === runId)!;

    expect(run.status).toBe("ended");
    expect(run.endedAt).not.toBeNull();
  });

  test("a run with one open and one already-ended node_run still shows as running", () => {
    makeNode("a", "claude-code");
    makeNode("b", "pi");
    const runId = getOrCreateCurrentRun();
    const finishedRunId = insertNodeRun(runId, "a");
    finishNodeRun(finishedRunId, "idle", "");
    insertNodeRun(runId, "b"); // still open

    const run = listRuns().find((r) => r.id === runId)!;

    expect(run.status).toBe("running");
  });
});
