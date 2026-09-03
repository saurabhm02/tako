import { beforeEach, describe, expect, test } from "bun:test";
import { closeDatabaseForTests, initDatabase } from "./db";
import { getOrCreateCurrentRun, resetCurrentRunForTests } from "./runsRepo";
import { ensureNodeExists, ensureWorkflowExists, setActiveWorkflowId, upsertConnection } from "./workflowsRepo";
import { getHandoff, insertHandoff, listPendingHandoffs, resetQueuedHandoffsToPending, updateHandoffStatus } from "./handoffsRepo";
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

function connect(fromNodeId: string, toNodeId: string) {
  const id = `${fromNodeId}->${toNodeId}`;
  upsertConnection({ id, workflowId: DEFAULT_WORKFLOW_ID, fromNodeId, toNodeId, autoApprove: false });
  return id;
}

beforeEach(() => {
  closeDatabaseForTests();
  initDatabase(":memory:");
  resetCurrentRunForTests();
});

describe("resetQueuedHandoffsToPending", () => {
  // The actual bug: HandoffQueue is in-memory only. Approve a handoff to a
  // busy node, quit before it frees up, and the row is stuck 'queued'
  // forever — invisible to listPendingHandoffs, never delivered.
  test("a handoff stuck 'queued' from a previous process becomes pending again, with its payload intact", () => {
    makeNode("a");
    makeNode("b");
    const connectionId = connect("a", "b");
    const runId = getOrCreateCurrentRun();
    const handoff = insertHandoff({
      runId,
      connectionId,
      fromNodeId: "a",
      toNodeId: "b",
      payloadText: "hello",
      autoApproved: false,
    });
    updateHandoffStatus(handoff.id, "queued");
    expect(listPendingHandoffs()).toEqual([]); // stuck, invisible to the sidebar

    resetQueuedHandoffsToPending();

    const pending = listPendingHandoffs();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(handoff.id);
    expect(pending[0].payloadText).toBe("hello");
  });

  test("leaves already-resolved handoffs (delivered, rejected) and already-pending ones untouched", () => {
    makeNode("a");
    makeNode("b");
    const connectionId = connect("a", "b");
    const runId = getOrCreateCurrentRun();
    const delivered = insertHandoff({ runId, connectionId, fromNodeId: "a", toNodeId: "b", payloadText: "one", autoApproved: false });
    updateHandoffStatus(delivered.id, "delivered");
    const rejected = insertHandoff({ runId, connectionId, fromNodeId: "a", toNodeId: "b", payloadText: "two", autoApproved: false });
    updateHandoffStatus(rejected.id, "rejected");
    const stillPending = insertHandoff({ runId, connectionId, fromNodeId: "a", toNodeId: "b", payloadText: "three", autoApproved: false });

    resetQueuedHandoffsToPending();

    expect(getHandoff(delivered.id)!.status).toBe("delivered");
    expect(getHandoff(rejected.id)!.status).toBe("rejected");
    expect(getHandoff(stillPending.id)!.status).toBe("pending");
  });
});

describe("listPendingHandoffs — scoped to the active workflow", () => {
  // The real bug: this query used to have no workflow filter at all, so
  // switching workflows left the Approval Sidebar showing a stale pending
  // card from whichever workflow was active when it was first fetched.
  function makeNodeInWorkflow(id: string, workflowId: string) {
    ensureNodeExists({
      id,
      workflowId,
      name: id,
      kind: "agent",
      agentType: "claude-code",
      adapterKind: "terminal",
      workingDirectory: null,
      config: {},
      position: { x: 0, y: 0 },
    });
  }

  test("a pending handoff on workflow A never appears while workflow B is active", () => {
    ensureWorkflowExists("wf-a", "Workflow A");
    ensureWorkflowExists("wf-b", "Workflow B");

    setActiveWorkflowId("wf-a");
    makeNodeInWorkflow("a1", "wf-a");
    makeNodeInWorkflow("a2", "wf-a");
    const connectionA = "a1->a2";
    upsertConnection({ id: connectionA, workflowId: "wf-a", fromNodeId: "a1", toNodeId: "a2", autoApprove: false });
    const runA = getOrCreateCurrentRun();
    const handoffA = insertHandoff({ runId: runA, connectionId: connectionA, fromNodeId: "a1", toNodeId: "a2", payloadText: "from A", autoApproved: false });

    setActiveWorkflowId("wf-b");
    expect(listPendingHandoffs()).toEqual([]); // A's pending handoff must not leak into B

    setActiveWorkflowId("wf-a");
    const pendingInA = listPendingHandoffs();
    expect(pendingInA).toHaveLength(1);
    expect(pendingInA[0].id).toBe(handoffA.id);

    setActiveWorkflowId(DEFAULT_WORKFLOW_ID); // restore for other tests sharing this module
  });
});
