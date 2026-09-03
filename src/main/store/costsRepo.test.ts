import { beforeEach, describe, expect, test } from "bun:test";
import { closeDatabaseForTests, initDatabase } from "./db";
import { getOrCreateCurrentRun, resetCurrentRunForTests } from "./runsRepo";
import { ensureNodeExists, ensureWorkflowExists } from "./workflowsRepo";
import { insertCost, getCostSummary, getCostSummaryForRun } from "./costsRepo";
import { DEFAULT_WORKFLOW_ID } from "../../shared/types";

function makeNode(id: string) {
  ensureWorkflowExists(DEFAULT_WORKFLOW_ID, "My Workflow");
  ensureNodeExists({
    id,
    workflowId: DEFAULT_WORKFLOW_ID,
    name: id,
    kind: "agent",
    agentType: "fake",
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

describe("costsRepo", () => {
  test("before any run exists, the summary reflects that plainly", () => {
    const summary = getCostSummary();
    expect(summary.currentRun).toBeNull();
    expect(summary.allTime).toEqual({ dollarTotal: 0, tokensOrUnits: 0, hasUnknown: false });
    expect(summary.perNode).toEqual([]);
  });

  test("an unknown-usage entry never becomes a dollar figure, but is flagged", () => {
    makeNode("a");
    const runId = getOrCreateCurrentRun();
    insertCost(runId, "a", "unknown");

    const summary = getCostSummary();
    expect(summary.currentRun).toEqual({ dollarTotal: 0, tokensOrUnits: 0, hasUnknown: true });
    expect(summary.perNode).toEqual([{ nodeId: "a", dollarTotal: 0, tokensOrUnits: 0, hasUnknown: true }]);
  });

  test("a real reported usage sums into the dollar and token totals, not just a flag", () => {
    makeNode("a");
    const runId = getOrCreateCurrentRun();
    insertCost(runId, "a", { dollarCost: 0.015, tokensOrUnits: 500 });

    const summary = getCostSummary();
    expect(summary.currentRun).toEqual({ dollarTotal: 0.015, tokensOrUnits: 500, hasUnknown: false });
  });

  test("known and unknown entries across nodes never get mixed into a false-precision total", () => {
    makeNode("a");
    makeNode("b");
    const runId = getOrCreateCurrentRun();
    insertCost(runId, "a", { dollarCost: 0.02, tokensOrUnits: 100 });
    insertCost(runId, "b", "unknown");

    const summary = getCostSummary();
    // The known $0.02 is real; the run as a whole still isn't "exactly $0.02"
    // because b's cost genuinely isn't known.
    expect(summary.currentRun).toEqual({ dollarTotal: 0.02, tokensOrUnits: 100, hasUnknown: true });

    const perNodeA = summary.perNode.find((n) => n.nodeId === "a")!;
    const perNodeB = summary.perNode.find((n) => n.nodeId === "b")!;
    expect(perNodeA).toEqual({ nodeId: "a", dollarTotal: 0.02, tokensOrUnits: 100, hasUnknown: false });
    expect(perNodeB).toEqual({ nodeId: "b", dollarTotal: 0, tokensOrUnits: 0, hasUnknown: true });
  });

  test("real token usage with no known price contributes tokens but is still flagged, not silently priced at zero", () => {
    makeNode("a");
    const runId = getOrCreateCurrentRun();
    insertCost(runId, "a", { tokensOrUnits: 500 }); // no dollarCost — model wasn't in the pricing table

    const summary = getCostSummary();
    expect(summary.currentRun).toEqual({ dollarTotal: 0, tokensOrUnits: 500, hasUnknown: true });
    expect(summary.perNode).toEqual([{ nodeId: "a", dollarTotal: 0, tokensOrUnits: 500, hasUnknown: true }]);
  });

  test("all-time total accumulates beyond just the current run", () => {
    makeNode("a");
    const runId = getOrCreateCurrentRun();
    insertCost(runId, "a", { dollarCost: 1, tokensOrUnits: 1000 });
    insertCost(runId, "a", { dollarCost: 2, tokensOrUnits: 2000 });

    expect(getCostSummary().allTime).toEqual({ dollarTotal: 3, tokensOrUnits: 3000, hasUnknown: false });
  });

  // Run History needs a past run's own total, not just whatever the live
  // "current run" happens to be right now.
  test("getCostSummaryForRun totals only that run, never mixing in another", () => {
    makeNode("a");
    const runId = getOrCreateCurrentRun();
    insertCost(runId, "a", { dollarCost: 0.5, tokensOrUnits: 200 });
    resetCurrentRunForTests();
    const otherRunId = getOrCreateCurrentRun();
    insertCost(otherRunId, "a", { dollarCost: 9, tokensOrUnits: 9000 });

    expect(getCostSummaryForRun(runId)).toEqual({ dollarTotal: 0.5, tokensOrUnits: 200, hasUnknown: false });
  });
});
