import { beforeEach, describe, expect, test } from "bun:test";
import { closeDatabaseForTests, initDatabase } from "./db";
import { getOrCreateCurrentRun, resetCurrentRunForTests } from "./runsRepo";
import { listRuns } from "./runHistoryRepo";
import { setActiveWorkflowId } from "./workflowsRepo";
import { DEFAULT_WORKFLOW_ID } from "../../shared/types";

beforeEach(() => {
  closeDatabaseForTests();
  initDatabase(":memory:");
  resetCurrentRunForTests();
});

describe("getOrCreateCurrentRun", () => {
  // Creating a new run must never reach back and touch any other run's rows
  // — the old "sweep every running run to ended" behavior did exactly that,
  // and got a run's displayed status wrong the moment more than one
  // "process boundary" existed. A run's displayed status is derived live
  // from its own node_runs (runHistoryRepo.test.ts), never mutated here.
  test("creating a new run never mutates a previous run's stored row", () => {
    const firstRunId = getOrCreateCurrentRun();
    resetCurrentRunForTests();

    const secondRunId = getOrCreateCurrentRun();

    expect(secondRunId).not.toBe(firstRunId);
    const rows = listRuns();
    expect(rows.map((r) => r.id).sort()).toEqual([firstRunId, secondRunId].sort());
  });

  // The multi-workflow regression: switching the active workflow (what
  // workflows:load's IPC handler does on every switch) must start a fresh
  // run scoped to the new workflow, never keep attributing activity to
  // whatever workflow was active before — without this, every workflow's
  // costs/handoffs/history would all land on the first workflow ever used.
  test("switching the active workflow starts a new run scoped to it, without an explicit reset", () => {
    setActiveWorkflowId("workflow-a");
    const runInA = getOrCreateCurrentRun();
    expect(listRuns().find((r) => r.id === runInA)!.workflowId).toBe("workflow-a");

    // Same workflow, called again — must reuse the same run, not create a
    // second one every time.
    expect(getOrCreateCurrentRun()).toBe(runInA);

    setActiveWorkflowId("workflow-b");
    const runInB = getOrCreateCurrentRun();

    expect(runInB).not.toBe(runInA);
    expect(listRuns().find((r) => r.id === runInB)!.workflowId).toBe("workflow-b");

    setActiveWorkflowId(DEFAULT_WORKFLOW_ID); // restore for other tests sharing this module
  });
});
