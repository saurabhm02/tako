import { describe, expect, it } from "bun:test";
import { formatStatus, hasPendingHandoffForEdge, pendingHandoffCountForNode } from "./types";
import { statusBucket } from "./overviewFilters";
import type { NodeRuntimeState, RuntimeHandoff, WorkflowRuntimeEvent } from "../../shared/types";

describe("Runtime UI Integration — Event Mapping, Statuses & Visual State", () => {
  it("formats canonical runtime states correctly for node badges and headers", () => {
    expect(formatStatus("idle")).toBe("idle");
    expect(formatStatus("queued")).toBe("queued");
    expect(formatStatus("running")).toBe("running");
    expect(formatStatus("completed")).toBe("completed");
    expect(formatStatus("failed")).toBe("failed");
    expect(formatStatus("blocked")).toBe("blocked");
    expect(formatStatus("cancelled")).toBe("cancelled");
  });

  it("maps canonical runtime states to overview buckets accurately", () => {
    expect(statusBucket("running")).toBe("running");
    expect(statusBucket("queued")).toBe("waiting");
    expect(statusBucket("blocked")).toBe("waiting");
    expect(statusBucket("failed")).toBe("error");
    expect(statusBucket("completed")).toBe("completed");
    expect(statusBucket("cancelled")).toBe("completed");
  });

  it("detects pending handoffs for nodes and edges using RuntimeHandoff models", () => {
    const handoffs: RuntimeHandoff[] = [
      {
        id: "h1",
        executionId: "exec-1",
        fromNodeId: "node-a",
        toNodeId: "node-b",
        sourceOutput: "Result A",
        timestamp: Date.now(),
        status: "created",
      },
      {
        id: "h2",
        executionId: "exec-1",
        fromNodeId: "node-b",
        toNodeId: "node-c",
        sourceOutput: "Result B",
        timestamp: Date.now(),
        status: "delivered",
      },
    ];

    // Node A has 1 active created handoff
    expect(pendingHandoffCountForNode(handoffs, "node-a")).toBe(1);
    // Node B has delivered handoff, so pending count is 0
    expect(pendingHandoffCountForNode(handoffs, "node-b")).toBe(0);

    // Edge A -> B has pending handoff
    expect(hasPendingHandoffForEdge(handoffs, "node-a", "node-b")).toBe(true);
    // Edge B -> C is already delivered, so not pending
    expect(hasPendingHandoffForEdge(handoffs, "node-b", "node-c")).toBe(false);
  });

  it("simulates full UI runtime lifecycle: Run -> Start -> Completed -> Handoff -> Stop", () => {
    const uiNodeStates: Record<string, NodeRuntimeState> = {
      "node-1": "idle",
      "node-2": "idle",
      "node-3": "idle",
    };

    let workflowState: string = "idle";
    const activeHandoffEdges = new Set<string>();
    const recordedHandoffs: RuntimeHandoff[] = [];

    // Mock handler simulating CanvasApp's runtime event dispatcher
    const handleRuntimeEvent = (event: WorkflowRuntimeEvent) => {
      switch (event.type) {
        case "WORKFLOW_STARTED":
          workflowState = "running";
          break;
        case "NODE_QUEUED":
          uiNodeStates[event.nodeId] = "queued";
          break;
        case "NODE_STARTED":
          uiNodeStates[event.nodeId] = "running";
          break;
        case "NODE_COMPLETED":
          uiNodeStates[event.nodeId] = "completed";
          break;
        case "NODE_FAILED":
          uiNodeStates[event.nodeId] = "failed";
          break;
        case "NODE_CANCELLED":
          uiNodeStates[event.nodeId] = "cancelled";
          break;
        case "HANDOFF_CREATED":
          recordedHandoffs.push(event.handoff);
          activeHandoffEdges.add(`${event.handoff.fromNodeId}>${event.handoff.toNodeId}`);
          break;
        case "HANDOFF_DELIVERED":
          const found = recordedHandoffs.find((h) => h.id === event.handoffId);
          if (found) found.status = "delivered";
          break;
        case "WORKFLOW_COMPLETED":
          workflowState = "completed";
          activeHandoffEdges.clear();
          break;
        case "WORKFLOW_CANCELLED":
          workflowState = "cancelled";
          activeHandoffEdges.clear();
          break;
      }
    };

    // Step 1: Workflow starts
    handleRuntimeEvent({
      id: "ev-1",
      executionId: "exec-1",
      workflowId: "wf-1",
      type: "WORKFLOW_STARTED",
      nodeIds: ["node-1", "node-2", "node-3"],
      timestamp: 100,
    });
    expect(workflowState).toBe("running");

    // Step 2: Node 1 runs
    handleRuntimeEvent({
      id: "ev-2",
      executionId: "exec-1",
      workflowId: "wf-1",
      type: "NODE_STARTED",
      nodeId: "node-1",
      input: {},
      timestamp: 110,
    });
    expect(uiNodeStates["node-1"]).toBe("running");

    // Step 3: Node 1 completes & creates handoff to Node 2
    handleRuntimeEvent({
      id: "ev-3",
      executionId: "exec-1",
      workflowId: "wf-1",
      type: "NODE_COMPLETED",
      nodeId: "node-1",
      output: { outputText: "Artifact generated" },
      timestamp: 120,
    });
    expect(uiNodeStates["node-1"]).toBe("completed");

    const handoff: RuntimeHandoff = {
      id: "h-1",
      executionId: "exec-1",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      sourceOutput: "Artifact generated",
      timestamp: 121,
      status: "created",
    };
    handleRuntimeEvent({
      id: "ev-4",
      executionId: "exec-1",
      workflowId: "wf-1",
      type: "HANDOFF_CREATED",
      handoff,
      timestamp: 121,
    });
    expect(activeHandoffEdges.has("node-1>node-2")).toBe(true);
    expect(recordedHandoffs.length).toBe(1);

    // Step 4: Node 2 queued and delivered
    handleRuntimeEvent({
      id: "ev-5",
      executionId: "exec-1",
      workflowId: "wf-1",
      type: "NODE_QUEUED",
      nodeId: "node-2",
      timestamp: 122,
    });
    expect(uiNodeStates["node-2"]).toBe("queued");

    handleRuntimeEvent({
      id: "ev-6",
      executionId: "exec-1",
      workflowId: "wf-1",
      type: "HANDOFF_DELIVERED",
      handoffId: "h-1",
      toNodeId: "node-2",
      timestamp: 123,
    });
    expect(recordedHandoffs[0].status).toBe("delivered");

    // Step 5: User clicks Stop
    handleRuntimeEvent({
      id: "ev-7",
      executionId: "exec-1",
      workflowId: "wf-1",
      type: "NODE_CANCELLED",
      nodeId: "node-2",
      timestamp: 130,
    });
    handleRuntimeEvent({
      id: "ev-8",
      executionId: "exec-1",
      workflowId: "wf-1",
      type: "WORKFLOW_CANCELLED",
      timestamp: 131,
    });

    expect(uiNodeStates["node-2"]).toBe("cancelled");
    expect(workflowState).toBe("cancelled");
  });
});
