import { describe, expect, it } from "bun:test";
import { WorkflowRuntime } from "./WorkflowRuntime";
import { InMemoryWorkflowRunStore } from "../store/workflowRunsRepo";
import type { INodeRunner, NodeRunnerContext } from "./types";
import type { NodeInput, NodeOutput, NodeRecord, ConnectionRecord, WorkflowRuntimeEvent } from "../../shared/types";

// Helper to create test NodeRecords
function createTestNode(id: string, name: string, agentType = "claude-code"): NodeRecord {
  return {
    id,
    name,
    kind: "agent",
    agentType,
    adapterKind: "terminal",
    workingDirectory: "/tmp",
    config: {},
    position: { x: 0, y: 0 },
  };
}

// Helper to create test ConnectionRecords
function createTestConnection(id: string, fromNodeId: string, toNodeId: string): ConnectionRecord {
  return {
    id,
    fromNodeId,
    toNodeId,
    autoApprove: true,
  };
}

describe("Workflow Runtime — Part 1 Architecture & Execution Engine", () => {
  it("1. Linear Graph (A -> B -> C) executes in correct sequential order with handoffs", async () => {
    const executionOrder: string[] = [];
    const receivedInputs: Record<string, string> = {};

    const mockRunner: INodeRunner = {
      async run(node: NodeRecord, input: NodeInput): Promise<NodeOutput> {
        executionOrder.push(node.id);
        const inputText = input.upstreamContext?.[0]?.sourceOutput ?? input.directInput ?? "";
        receivedInputs[node.id] = inputText;
        return { outputText: `Output from ${node.name} (received: ${inputText})` };
      },
    };

    const runtime = new WorkflowRuntime({
      nodeRunner: mockRunner,
      store: new InMemoryWorkflowRunStore(),
    });

    const workflow = {
      id: "wf-linear",
      name: "Linear Pipeline",
      nodes: [
        createTestNode("node-a", "Node A"),
        createTestNode("node-b", "Node B"),
        createTestNode("node-c", "Node C"),
      ],
      connections: [
        createTestConnection("e1", "node-a", "node-b"),
        createTestConnection("e2", "node-b", "node-c"),
      ],
    };

    const run = await runtime.startWorkflow(workflow, {
      initialInputs: { "node-a": "Initial Task" },
    });

    expect(run.status).toBe("completed");
    expect(executionOrder).toEqual(["node-a", "node-b", "node-c"]);

    expect(run.nodeRuns["node-a"].status).toBe("completed");
    expect(run.nodeRuns["node-b"].status).toBe("completed");
    expect(run.nodeRuns["node-c"].status).toBe("completed");

    expect(receivedInputs["node-a"]).toBe("Initial Task");
    expect(receivedInputs["node-b"]).toBe("Output from Node A (received: Initial Task)");
    expect(receivedInputs["node-c"]).toBe("Output from Node B (received: Output from Node A (received: Initial Task))");

    expect(run.handoffs.length).toBe(2);
    expect(run.handoffs[0].fromNodeId).toBe("node-a");
    expect(run.handoffs[0].toNodeId).toBe("node-b");
    expect(run.handoffs[0].status).toBe("delivered");
    expect(run.handoffs[1].fromNodeId).toBe("node-b");
    expect(run.handoffs[1].toNodeId).toBe("node-c");
    expect(run.handoffs[1].status).toBe("delivered");
  });

  it("2. Branch Graph (A -> B, A -> C) makes both B and C runnable after A", async () => {
    const completedNodes: string[] = [];

    const mockRunner: INodeRunner = {
      async run(node: NodeRecord): Promise<NodeOutput> {
        completedNodes.push(node.id);
        return { outputText: `Output from ${node.id}` };
      },
    };

    const runtime = new WorkflowRuntime({
      nodeRunner: mockRunner,
      store: new InMemoryWorkflowRunStore(),
    });

    const workflow = {
      id: "wf-branch",
      name: "Branch Pipeline",
      nodes: [
        createTestNode("node-a", "Node A"),
        createTestNode("node-b", "Node B"),
        createTestNode("node-c", "Node C"),
      ],
      connections: [
        createTestConnection("e1", "node-a", "node-b"),
        createTestConnection("e2", "node-a", "node-c"),
      ],
    };

    const run = await runtime.startWorkflow(workflow);

    expect(run.status).toBe("completed");
    expect(completedNodes[0]).toBe("node-a");
    expect(completedNodes.slice(1).sort()).toEqual(["node-b", "node-c"]);

    expect(run.nodeRuns["node-a"].status).toBe("completed");
    expect(run.nodeRuns["node-b"].status).toBe("completed");
    expect(run.nodeRuns["node-c"].status).toBe("completed");
  });

  it("3. Merge Graph (B -> D, C -> D) waits until both B and C are completed before running D", async () => {
    const startTimes: Record<string, number> = {};
    const finishTimes: Record<string, number> = {};

    const mockRunner: INodeRunner = {
      async run(node: NodeRecord): Promise<NodeOutput> {
        startTimes[node.id] = Date.now();
        if (node.id === "node-b") await new Promise((r) => setTimeout(r, 40));
        if (node.id === "node-c") await new Promise((r) => setTimeout(r, 20));
        finishTimes[node.id] = Date.now();
        return { outputText: `Result from ${node.name}` };
      },
    };

    const runtime = new WorkflowRuntime({
      nodeRunner: mockRunner,
      store: new InMemoryWorkflowRunStore(),
    });

    const workflow = {
      id: "wf-merge",
      name: "Merge Pipeline",
      nodes: [
        createTestNode("node-b", "Node B"),
        createTestNode("node-c", "Node C"),
        createTestNode("node-d", "Node D"),
      ],
      connections: [
        createTestConnection("e1", "node-b", "node-d"),
        createTestConnection("e2", "node-c", "node-d"),
      ],
    };

    const run = await runtime.startWorkflow(workflow);

    expect(run.status).toBe("completed");
    expect(run.nodeRuns["node-d"].status).toBe("completed");

    // Node D must start only AFTER both B and C have finished
    expect(startTimes["node-d"]).toBeGreaterThanOrEqual(finishTimes["node-b"]);
    expect(startTimes["node-d"]).toBeGreaterThanOrEqual(finishTimes["node-c"]);

    // Node D should have received both handoffs
    expect(run.nodeRuns["node-d"].input?.upstreamContext?.length).toBe(2);
  });

  it("4. Failure Behavior (A -> B -> C, B fails): A completed, B failed, C blocked, workflow failed", async () => {
    const executed: string[] = [];

    const mockRunner: INodeRunner = {
      async run(node: NodeRecord): Promise<NodeOutput> {
        executed.push(node.id);
        if (node.id === "node-b") {
          throw new Error("Simulated network outage in Node B");
        }
        return { outputText: `Done ${node.id}` };
      },
    };

    const runtime = new WorkflowRuntime({
      nodeRunner: mockRunner,
      store: new InMemoryWorkflowRunStore(),
    });

    const workflow = {
      id: "wf-fail",
      name: "Failure Pipeline",
      nodes: [
        createTestNode("node-a", "Node A"),
        createTestNode("node-b", "Node B"),
        createTestNode("node-c", "Node C"),
      ],
      connections: [
        createTestConnection("e1", "node-a", "node-b"),
        createTestConnection("e2", "node-b", "node-c"),
      ],
    };

    const run = await runtime.startWorkflow(workflow);

    expect(run.status).toBe("failed");
    expect(run.nodeRuns["node-a"].status).toBe("completed");
    expect(run.nodeRuns["node-b"].status).toBe("failed");
    expect(run.nodeRuns["node-b"].error?.message).toContain("Simulated network outage in Node B");
    expect(run.nodeRuns["node-c"].status).toBe("blocked");

    // Node C must NEVER have been executed
    expect(executed).toEqual(["node-a", "node-b"]);
  });

  it("5. Cancellation: cancelling a running workflow halts execution and prevents queued nodes from starting", async () => {
    let nodeARan = false;
    let nodeBRan = false;

    const mockRunner: INodeRunner = {
      async run(node: NodeRecord, _input: NodeInput, ctx: NodeRunnerContext): Promise<NodeOutput> {
        if (node.id === "node-a") {
          nodeARan = true;
          // Wait for cancellation
          await new Promise<void>((resolve, reject) => {
            ctx.signal?.addEventListener("abort", () => {
              reject(new Error("Cancelled"));
            });
          });
        }
        if (node.id === "node-b") {
          nodeBRan = true;
        }
        return { outputText: "ok" };
      },
    };

    const runtime = new WorkflowRuntime({
      nodeRunner: mockRunner,
      store: new InMemoryWorkflowRunStore(),
    });

    const workflow = {
      id: "wf-cancel",
      name: "Cancel Pipeline",
      nodes: [
        createTestNode("node-a", "Node A"),
        createTestNode("node-b", "Node B"),
      ],
      connections: [createTestConnection("e1", "node-a", "node-b")],
    };

    const startPromise = runtime.startWorkflow(workflow, { executionId: "exec-cancel-1" });

    // Allow node-a to start running
    await new Promise((r) => setTimeout(r, 20));
    await runtime.cancelWorkflow("exec-cancel-1");

    const run = await startPromise;

    expect(run.status).toBe("cancelled");
    expect(nodeARan).toBe(true);
    expect(nodeBRan).toBe(false);
    expect(run.nodeRuns["node-a"].status).toBe("cancelled");
    expect(run.nodeRuns["node-b"].status).toBe("cancelled");
  });

  it("6. Retry: failed node can be retried independently and resumes downstream execution", async () => {
    let failNodeB = true;
    const executed: string[] = [];

    const mockRunner: INodeRunner = {
      async run(node: NodeRecord): Promise<NodeOutput> {
        executed.push(node.id);
        if (node.id === "node-b" && failNodeB) {
          throw new Error("Node B initial failure");
        }
        return { outputText: `Success from ${node.name}` };
      },
    };

    const runtime = new WorkflowRuntime({
      nodeRunner: mockRunner,
      store: new InMemoryWorkflowRunStore(),
    });

    const workflow = {
      id: "wf-retry",
      name: "Retry Pipeline",
      nodes: [
        createTestNode("node-a", "Node A"),
        createTestNode("node-b", "Node B"),
        createTestNode("node-c", "Node C"),
      ],
      connections: [
        createTestConnection("e1", "node-a", "node-b"),
        createTestConnection("e2", "node-b", "node-c"),
      ],
    };

    const initialRun = await runtime.startWorkflow(workflow, { executionId: "exec-retry-1" });

    expect(initialRun.status).toBe("failed");
    expect(initialRun.nodeRuns["node-a"].status).toBe("completed");
    expect(initialRun.nodeRuns["node-b"].status).toBe("failed");
    expect(initialRun.nodeRuns["node-c"].status).toBe("blocked");

    // Now fix the issue and retry Node B
    failNodeB = false;
    const retriedRun = await runtime.retryNode("exec-retry-1", "node-b");

    expect(retriedRun.status).toBe("completed");
    expect(retriedRun.nodeRuns["node-b"].status).toBe("completed");
    expect(retriedRun.nodeRuns["node-c"].status).toBe("completed");
    expect(executed).toEqual(["node-a", "node-b", "node-b", "node-c"]);
  });

  it("7. Adapter Abstraction: works uniformly across diverse agent types via dynamic resolution", async () => {
    const invokedAgentTypes: string[] = [];

    const customAdapterFactory = (agentType: string) => {
      invokedAgentTypes.push(agentType);
      return {
        kind: "terminal" as const,
        async start() {},
        async send() {},
        onOutput() {
          return () => {};
        },
        onCompletionSignal(cb: () => void) {
          setTimeout(cb, 5);
          return () => {};
        },
        onError() {
          return () => {};
        },
        getUsage: () => ({ tokensOrUnits: 100, dollarCost: 0.05 }),
        getFinalOutput: () => `Answer from ${agentType}`,
        async stop() {},
      };
    };

    const runtime = new WorkflowRuntime({
      nodeRunner: new (class extends (await import("./NodeRunner")).NodeRunner {
        constructor() {
          super(customAdapterFactory);
        }
      })(),
      store: new InMemoryWorkflowRunStore(),
    });

    const workflow = {
      id: "wf-adapters",
      name: "Multi-Agent Pipeline",
      nodes: [
        createTestNode("n1", "Claude Node", "claude-code"),
        createTestNode("n2", "Antigravity Node", "antigravity"),
        createTestNode("n3", "Gemini Node", "gemini"),
      ],
      connections: [
        createTestConnection("e1", "n1", "n2"),
        createTestConnection("e2", "n2", "n3"),
      ],
    };

    const run = await runtime.startWorkflow(workflow);

    expect(run.status).toBe("completed");
    expect(invokedAgentTypes).toEqual(["claude-code", "antigravity", "gemini"]);
    expect(run.nodeRuns["n1"].output?.outputText).toBe("Answer from claude-code");
    expect(run.nodeRuns["n2"].output?.outputText).toBe("Answer from antigravity");
    expect(run.nodeRuns["n3"].output?.outputText).toBe("Answer from gemini");
  });

  it("8. Cycle Safety: detects invalid cyclic graphs defensively and fails gracefully without hanging", async () => {
    const runtime = new WorkflowRuntime({
      nodeRunner: {
        async run(): Promise<NodeOutput> {
          return { outputText: "never" };
        },
      },
      store: new InMemoryWorkflowRunStore(),
    });

    const cyclicWorkflow = {
      id: "wf-cyclic",
      name: "Cyclic Pipeline",
      nodes: [
        createTestNode("node-a", "Node A"),
        createTestNode("node-b", "Node B"),
      ],
      connections: [
        createTestConnection("e1", "node-a", "node-b"),
        createTestConnection("e2", "node-b", "node-a"),
      ],
    };

    const run = await runtime.startWorkflow(cyclicWorkflow);

    expect(run.status).toBe("failed");
    expect(run.error?.code).toBe("CYCLIC_DEPENDENCY");
    expect(run.error?.message).toContain("circular");
  });

  it("9. Parallel Execution: independent concurrent nodes run simultaneously", async () => {
    let activeRunningCount = 0;
    let maxObservedConcurrency = 0;

    const mockRunner: INodeRunner = {
      async run(node: NodeRecord): Promise<NodeOutput> {
        activeRunningCount++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, activeRunningCount);

        // Hold running state to observe concurrency
        await new Promise((r) => setTimeout(r, 40));

        activeRunningCount--;
        return { outputText: `Done ${node.id}` };
      },
    };

    const runtime = new WorkflowRuntime({
      nodeRunner: mockRunner,
      maxConcurrency: 3,
      store: new InMemoryWorkflowRunStore(),
    });

    const parallelWorkflow = {
      id: "wf-parallel",
      name: "Parallel Pipeline",
      nodes: [
        createTestNode("n1", "Node 1"),
        createTestNode("n2", "Node 2"),
        createTestNode("n3", "Node 3"),
      ],
      connections: [], // All root nodes, fully independent
    };

    const run = await runtime.startWorkflow(parallelWorkflow);

    expect(run.status).toBe("completed");
    expect(maxObservedConcurrency).toBe(3);
    expect(Object.values(run.nodeRuns).every((nr) => nr.status === "completed")).toBe(true);
  });

  it("10. Canonical Runtime Events: emits structured events for all lifecycle stages", async () => {
    const events: WorkflowRuntimeEvent[] = [];

    const mockRunner: INodeRunner = {
      async run(node: NodeRecord, _input: NodeInput, ctx: NodeRunnerContext): Promise<NodeOutput> {
        ctx.onOutput?.("streamed output chunk");
        return { outputText: `Result ${node.name}` };
      },
    };

    const runtime = new WorkflowRuntime({
      nodeRunner: mockRunner,
      store: new InMemoryWorkflowRunStore(),
    });

    runtime.onEvent((ev) => events.push(ev));

    const workflow = {
      id: "wf-events",
      name: "Events Test",
      nodes: [
        createTestNode("n1", "Node 1"),
        createTestNode("n2", "Node 2"),
      ],
      connections: [createTestConnection("e1", "n1", "n2")],
    };

    await runtime.startWorkflow(workflow);

    const eventTypes = events.map((e) => e.type);

    expect(eventTypes).toContain("WORKFLOW_STARTED");
    expect(eventTypes).toContain("NODE_QUEUED");
    expect(eventTypes).toContain("NODE_STARTED");
    expect(eventTypes).toContain("NODE_OUTPUT");
    expect(eventTypes).toContain("NODE_COMPLETED");
    expect(eventTypes).toContain("HANDOFF_CREATED");
    expect(eventTypes).toContain("HANDOFF_DELIVERED");
    expect(eventTypes).toContain("WORKFLOW_COMPLETED");
  });

  it("11. Disconnected Components: executes multiple independent chains (A -> B and C -> D) concurrently", async () => {
    const executed: string[] = [];

    const mockRunner: INodeRunner = {
      async run(node: NodeRecord): Promise<NodeOutput> {
        executed.push(node.id);
        return { outputText: `Finished ${node.id}` };
      },
    };

    const runtime = new WorkflowRuntime({
      nodeRunner: mockRunner,
      store: new InMemoryWorkflowRunStore(),
    });

    const workflow = {
      id: "wf-disconnected",
      name: "Disconnected Pipeline",
      nodes: [
        createTestNode("a", "Node A"),
        createTestNode("b", "Node B"),
        createTestNode("c", "Node C"),
        createTestNode("d", "Node D"),
      ],
      connections: [
        createTestConnection("e1", "a", "b"),
        createTestConnection("e2", "c", "d"),
      ],
    };

    const run = await runtime.startWorkflow(workflow);

    expect(run.status).toBe("completed");
    expect(executed.indexOf("a")).toBeLessThan(executed.indexOf("b"));
    expect(executed.indexOf("c")).toBeLessThan(executed.indexOf("d"));
    expect(Object.values(run.nodeRuns).every((nr) => nr.status === "completed")).toBe(true);
  });

  it("12. Empty Graph: completes immediately with status completed", async () => {
    const runtime = new WorkflowRuntime({
      nodeRunner: {
        async run(): Promise<NodeOutput> {
          return { outputText: "" };
        },
      },
      store: new InMemoryWorkflowRunStore(),
    });

    const emptyWorkflow = {
      id: "wf-empty",
      name: "Empty Pipeline",
      nodes: [],
      connections: [],
    };

    const run = await runtime.startWorkflow(emptyWorkflow);

    expect(run.status).toBe("completed");
    expect(run.events[0].type).toBe("WORKFLOW_STARTED");
    expect(run.events[1].type).toBe("WORKFLOW_COMPLETED");
  });

  it("13. Input Preparation: formats multi-source handoffs and direct input cleanly", async () => {
    const { prepareInputText } = await import("./NodeRunner");

    const singleInput = prepareInputText({
      directInput: "Hello Agent",
      upstreamContext: [
        {
          id: "h1",
          executionId: "e1",
          fromNodeId: "n1",
          toNodeId: "n2",
          sourceOutput: "Upstream Answer 1",
          timestamp: 123,
          status: "delivered",
        },
      ],
    });

    expect(singleInput).toBe("Hello Agent\n\nUpstream Answer 1");

    const multiInput = prepareInputText({
      upstreamContext: [
        {
          id: "h1",
          executionId: "e1",
          fromNodeId: "n1",
          toNodeId: "n3",
          sourceOutput: "Output from N1",
          timestamp: 123,
          status: "delivered",
        },
        {
          id: "h2",
          executionId: "e1",
          fromNodeId: "n2",
          toNodeId: "n3",
          sourceOutput: "Output from N2",
          timestamp: 124,
          status: "delivered",
        },
      ],
    });

    expect(multiInput).toContain("--- Input 1 (from node n1) ---");
    expect(multiInput).toContain("Output from N1");
    expect(multiInput).toContain("--- Input 2 (from node n2) ---");
    expect(multiInput).toContain("Output from N2");
  });

  it("14. SQLite Persistence: SqliteWorkflowRunStore persists and retrieves full WorkflowRun", async () => {
    const { initDatabase, closeDatabaseForTests } = await import("../store/db");
    const { SqliteWorkflowRunStore } = await import("../store/workflowRunsRepo");

    closeDatabaseForTests();
    initDatabase(":memory:");

    const store = new SqliteWorkflowRunStore();
    const runtime = new WorkflowRuntime({
      nodeRunner: {
        async run(node: NodeRecord): Promise<NodeOutput> {
          return { outputText: `Output of ${node.name}` };
        },
      },
      store,
    });

    const workflow = {
      id: "wf-sqlite-test",
      name: "SQLite Persist Pipeline",
      nodes: [
        createTestNode("node-1", "Node 1"),
        createTestNode("node-2", "Node 2"),
      ],
      connections: [createTestConnection("e1", "node-1", "node-2")],
    };

    const initialRun = await runtime.startWorkflow(workflow);
    expect(initialRun.status).toBe("completed");

    const loadedRun = await store.getRun(initialRun.executionId);
    expect(loadedRun).not.toBeNull();
    expect(loadedRun?.executionId).toBe(initialRun.executionId);
    expect(loadedRun?.status).toBe("completed");
    expect(loadedRun?.nodeRuns["node-1"].status).toBe("completed");
    expect(loadedRun?.nodeRuns["node-2"].status).toBe("completed");
    expect(loadedRun?.nodeRuns["node-1"].output?.outputText).toBe("Output of Node 1");
    expect(loadedRun?.nodeRuns["node-2"].output?.outputText).toBe("Output of Node 2");

    const runsList = await store.listRuns("wf-sqlite-test");
    expect(runsList.length).toBeGreaterThanOrEqual(1);
  });
});

