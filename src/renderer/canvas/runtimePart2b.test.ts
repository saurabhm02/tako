import { describe, expect, it } from "bun:test";
import { formatEventDetails } from "./ActivityTimeline";
import { formatDuration } from "./RunHistoryViewer";
import { interpret, resolveActionsSequential } from "./commandLayer";
import type { WorkflowRun, WorkflowRuntimeEvent } from "../../shared/types";
import type { TakoNode } from "./types";
import { InMemoryWorkflowRunStore } from "../../main/store/workflowRunsRepo";

describe("PART 2B — Activity Timeline, Run History, Retry UX & Commands", () => {
  describe("Activity Timeline Event Formatting & Sanitization", () => {
    const nodeLabel = (id: string) => (id === "n1" ? "Claude" : id === "n2" ? "Codex" : id);

    it("formats WORKFLOW_STARTED event", () => {
      const event: WorkflowRuntimeEvent = {
        id: "e1",
        executionId: "exec-1",
        workflowId: "wf-1",
        timestamp: Date.now(),
        type: "WORKFLOW_STARTED",
        nodeIds: ["n1", "n2"],
      };
      const formatted = formatEventDetails(event, nodeLabel);
      expect(formatted.title).toBe("Workflow started");
      expect(formatted.subtitle).toContain("2 node(s)");
      expect(formatted.icon).toBe("start");
    });

    it("formats NODE_STARTED and NODE_COMPLETED events with output preview", () => {
      const startEvent: WorkflowRuntimeEvent = {
        id: "e2",
        executionId: "exec-1",
        workflowId: "wf-1",
        timestamp: Date.now(),
        type: "NODE_STARTED",
        nodeId: "n1",
        input: { directInput: "test" },
      };
      const startFormatted = formatEventDetails(startEvent, nodeLabel);
      expect(startFormatted.title).toBe("Claude started");
      expect(startFormatted.nodeId).toBe("n1");
      expect(startFormatted.icon).toBe("start");

      const completeEvent: WorkflowRuntimeEvent = {
        id: "e3",
        executionId: "exec-1",
        workflowId: "wf-1",
        timestamp: Date.now(),
        type: "NODE_COMPLETED",
        nodeId: "n1",
        output: { outputText: "Created user authentication module successfully." },
      };
      const completeFormatted = formatEventDetails(completeEvent, nodeLabel);
      expect(completeFormatted.title).toBe("Claude completed");
      expect(completeFormatted.subtitle).toBe("Created user authentication module successfully.");
      expect(completeFormatted.icon).toBe("complete");
    });

    it("sanitizes API keys and tokens in failed event messages", () => {
      const failEvent: WorkflowRuntimeEvent = {
        id: "e4",
        executionId: "exec-1",
        workflowId: "wf-1",
        timestamp: Date.now(),
        type: "NODE_FAILED",
        nodeId: "n2",
        error: {
          code: "CRASH",
          message: "Request failed with key sk-abcdef123456789012345678 and Bearer secret-bearer-token-1234567890",
          recoverable: true,
        },
      };
      const failFormatted = formatEventDetails(failEvent, nodeLabel);
      expect(failFormatted.title).toBe("Codex failed");
      expect(failFormatted.subtitle).not.toContain("sk-abcdef123456789012345678");
      expect(failFormatted.subtitle).not.toContain("secret-bearer-token-1234567890");
      expect(failFormatted.subtitle).toContain("sk-***");
      expect(failFormatted.subtitle).toContain("Bearer ***");
      expect(failFormatted.icon).toBe("fail");
    });

    it("formats HANDOFF_CREATED and HANDOFF_DELIVERED events", () => {
      const handoffEvent: WorkflowRuntimeEvent = {
        id: "e5",
        executionId: "exec-1",
        workflowId: "wf-1",
        timestamp: Date.now(),
        type: "HANDOFF_CREATED",
        handoff: {
          id: "h1",
          executionId: "exec-1",
          fromNodeId: "n1",
          toNodeId: "n2",
          sourceOutput: "auth specs",
          timestamp: Date.now(),
          status: "created",
        },
      };
      const handoffFormatted = formatEventDetails(handoffEvent, nodeLabel);
      expect(handoffFormatted.title).toBe("Handoff: Claude → Codex");
      expect(handoffFormatted.icon).toBe("handoff");
    });
  });

  describe("Run History Duration & Inspection", () => {
    it("formats execution durations accurately", () => {
      expect(formatDuration(1000, 1000)).toBe("0s");
      expect(formatDuration(1000, 45000)).toBe("44s");
      expect(formatDuration(1000, 61000)).toBe("1m");
      expect(formatDuration(1000, 125000)).toBe("2m");
      expect(formatDuration(1000, 3661000)).toBe("1h 1m");
      expect(formatDuration(1000, null)).toBeNull();
    });
  });

  describe("Command Bar — Workflow Runtime Commands", () => {
    const mockNodes: TakoNode[] = [
      {
        id: "node-1",
        type: "agentNode",
        position: { x: 0, y: 0 },
        data: {
          name: "Apollo",
          kind: "agent",
          agentType: "claude-code",
          adapterKind: "terminal",
          status: "failed",
          workingDirectory: "/tmp",
          config: {},
          sessionRef: null,
          profileId: null,
          error: { kind: "crash", message: "Error in step", recoverable: true },
          lastCodeChange: null,
          lastActivityAt: null,
        },
      },
      {
        id: "node-2",
        type: "agentNode",
        position: { x: 200, y: 0 },
        data: {
          name: "Codex Worker",
          kind: "agent",
          agentType: "codex",
          adapterKind: "terminal",
          status: "idle",
          workingDirectory: "/tmp",
          config: {},
          sessionRef: null,
          profileId: null,
          error: null,
          lastCodeChange: null,
          lastActivityAt: null,
        },
      },
    ];

    const mockCtx = {
      nodes: mockNodes,
      edges: [],
      adapters: [],
      profilesByAgentType: {},
      selectedNodeId: null,
    };

    it("parses and resolves 'run workflow' command", () => {
      const parsed = interpret("run this workflow");
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("Expected ok");
      expect(parsed.actions).toEqual([{ type: "runWorkflow" }]);

      const resolved = resolveActionsSequential(parsed.actions, mockCtx);
      expect(resolved[0].ok).toBe(true);
      if (resolved[0].ok) {
        expect(resolved[0].action).toEqual({ kind: "runWorkflow" });
        expect(resolved[0].description).toBe("Run this workflow.");
      }
    });

    it("parses and resolves 'stop workflow' command", () => {
      const parsed = interpret("stop workflow");
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("Expected ok");
      expect(parsed.actions).toEqual([{ type: "stopWorkflow" }]);

      const resolved = resolveActionsSequential(parsed.actions, mockCtx);
      expect(resolved[0].ok).toBe(true);
      if (resolved[0].ok) {
        expect(resolved[0].action).toEqual({ kind: "stopWorkflow" });
        expect(resolved[0].description).toBe("Stop the active workflow run.");
        expect(resolved[0].destructive).toBe(true);
      }
    });

    it("parses and resolves 'retry' for failed node", () => {
      const parsed = interpret("retry Apollo");
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("Expected ok");
      expect(parsed.actions).toEqual([{ type: "retryNode", nodeRef: "Apollo" }]);

      const resolved = resolveActionsSequential(parsed.actions, mockCtx);
      expect(resolved[0].ok).toBe(true);
      if (resolved[0].ok) {
        expect(resolved[0].action).toEqual({ kind: "retryNode", nodeId: "node-1" });
        expect(resolved[0].description).toContain("Apollo");
      }
    });

    it("resolves bare 'retry' by picking the failed node automatically", () => {
      const parsed = interpret("retry");
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("Expected ok");
      expect(parsed.actions).toEqual([{ type: "retryNode", nodeRef: undefined }]);

      const resolved = resolveActionsSequential(parsed.actions, mockCtx);
      expect(resolved[0].ok).toBe(true);
      if (resolved[0].ok) {
        expect(resolved[0].action).toEqual({ kind: "retryNode", nodeId: "node-1" });
      }
    });
  });

  describe("Persistence & Run History Store", () => {
    it("stores runs and retrieves them via listRuns and getRun", async () => {
      const store = new InMemoryWorkflowRunStore();
      const run: WorkflowRun = {
        executionId: "exec-test-1",
        workflowId: "wf-1",
        workflowName: "Test Pipeline",
        startedAt: 1000,
        completedAt: 5000,
        status: "completed",
        nodeRuns: {
          "n1": {
            nodeId: "n1",
            nodeName: "Claude",
            agentType: "claude-code",
            startedAt: 1000,
            completedAt: 5000,
            status: "completed",
            input: null,
            output: { outputText: "Generated report" },
            error: null,
            sessionRef: null,
          },
        },
        handoffs: [],
        events: [],
        error: null,
      };

      store.saveRun(run);

      const list = store.listRuns("wf-1");
      expect(list.length).toBe(1);
      expect(list[0].executionId).toBe("exec-test-1");
      expect(list[0].status).toBe("completed");

      const fetched = store.getRun("exec-test-1");
      expect(fetched).not.toBeNull();
      expect(fetched?.nodeRuns["n1"].output?.outputText).toBe("Generated report");
    });
  });
});
