import { describe, expect, it } from "bun:test";
import { NodeRunner } from "./NodeRunner";
import type { Adapter, AdapterError } from "../adapters/Adapter";
import type { AdapterKind, NodeInput, NodeOutput, NodeRecord } from "../../shared/types";
import type { NodeRunnerContext } from "./types";

class MockAdapter implements Adapter {
  readonly kind: AdapterKind = "terminal";
  readonly agentType: string;
  readonly workingDirectory: string | null;
  readonly config: Record<string, unknown>;
  public receivedInput = "";
  public started = false;
  public wasStarted = false;
  public simulatedOutput = "Default output";
  private outputHandlers: Array<(chunk: string) => void> = [];
  private completionHandlers: Array<() => void> = [];

  constructor(agentType: string, options: { workingDirectory: string | null; config: Record<string, unknown> }) {
    this.agentType = agentType;
    this.workingDirectory = options.workingDirectory;
    this.config = options.config;
  }

  async start(): Promise<void> {
    this.started = true;
    this.wasStarted = true;
  }

  async send(text: string): Promise<void> {
    this.receivedInput = text;
    for (const handler of this.outputHandlers) {
      handler(this.simulatedOutput);
    }
    queueMicrotask(() => {
      for (const handler of this.completionHandlers) {
        handler();
      }
    });
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async dispose(): Promise<void> {
    this.started = false;
  }

  onOutput(handler: (chunk: string) => void): () => void {
    this.outputHandlers.push(handler);
    return () => {
      this.outputHandlers = this.outputHandlers.filter((h) => h !== handler);
    };
  }

  onCompletionSignal(handler: () => void): () => void {
    this.completionHandlers.push(handler);
    return () => {
      this.completionHandlers = this.completionHandlers.filter((h) => h !== handler);
    };
  }

  onError(handler: (error: AdapterError) => void): () => void {
    return () => {};
  }

  getUsage() {
    return { tokensOrUnits: 150, dollarCost: 0.005 };
  }

  getFinalOutput() {
    return this.simulatedOutput;
  }
}

describe("NodeRunner Role + Harness Execution Seam", () => {
  const createMockContext = (): NodeRunnerContext => ({
    executionId: "exec-test-1",
    workflowId: "wf-test-1",
    signal: new AbortController().signal,
  });

  it("executes a role-configured node by preparing Harness instructions", async () => {
    let createdAdapter: MockAdapter | null = null;

    const runner = new NodeRunner((agentType, options) => {
      createdAdapter = new MockAdapter(agentType, options);
      createdAdapter.simulatedOutput = "# PRD: URL Shortener\nRequirements defined.";
      return createdAdapter;
    });

    const pmNode: NodeRecord = {
      id: "node-pm",
      name: "Product Manager",
      kind: "agent",
      agentType: "claude-code",
      adapterKind: "terminal",
      workingDirectory: null,
      roleId: "product-manager",
      config: {
        roleId: "product-manager",
        taskPrompt: "Define requirements for a distributed URL shortener.",
      },
      position: { x: 0, y: 0 },
    };

    const input: NodeInput = {
      directInput: "Focus on 100k writes/sec.",
    };

    const output = await runner.run(pmNode, input, createMockContext());

    expect(createdAdapter).not.toBeNull();
    expect(createdAdapter!.wasStarted).toBe(true);
    // Role instructions injected into prompt
    expect(createdAdapter!.receivedInput).toContain("[ROLE: Product Manager]");
    expect(createdAdapter!.receivedInput).toContain("Define requirements for a distributed URL shortener.");
    expect(output.outputText).toBe("# PRD: URL Shortener\nRequirements defined.");
    expect(output.metadata?.roleId).toBe("product-manager");
  });

  it("swaps underlying adapter seamlessly while maintaining identical Role instructions", async () => {
    let capturedAdapterType = "";

    const runner = new NodeRunner((agentType, options) => {
      capturedAdapterType = agentType;
      const adapter = new MockAdapter(agentType, options);
      adapter.simulatedOutput = "Architecture design complete.";
      return adapter;
    });

    const archNodeCodex: NodeRecord = {
      id: "node-arch",
      name: "Software Architect",
      kind: "agent",
      agentType: "codex", // Swapped to codex
      adapterKind: "terminal",
      workingDirectory: null,
      roleId: "software-architect",
      config: {
        taskPrompt: "Design storage layout.",
      },
      position: { x: 0, y: 0 },
    };

    const output = await runner.run(archNodeCodex, {}, createMockContext());

    expect(capturedAdapterType).toBe("codex");
    expect(output.outputText).toBe("Architecture design complete.");
    expect(output.metadata?.roleId).toBe("software-architect");
  });

  it("formats and forwards upstream handoff context to downstream role node", async () => {
    let capturedInput = "";

    const runner = new NodeRunner((agentType, options) => {
      const adapter = new MockAdapter(agentType, options);
      const originalSend = adapter.send.bind(adapter);
      adapter.send = async (text: string) => {
        capturedInput = text;
        adapter.simulatedOutput = "Review verdict: Approved with zero caveats.";
        return originalSend(text);
      };
      return adapter;
    });

    const reviewerNode: NodeRecord = {
      id: "node-rev",
      name: "Reviewer",
      kind: "agent",
      agentType: "claude-code",
      adapterKind: "terminal",
      workingDirectory: null,
      roleId: "reviewer",
      config: {
        taskPrompt: "Validate architecture against requirements.",
      },
      position: { x: 0, y: 0 },
    };

    const inputWithHandoff: NodeInput = {
      upstreamContext: [
        {
          id: "h1",
          executionId: "exec-test-1",
          fromNodeId: "node-arch",
          toNodeId: "node-rev",
          sourceOutput: "# System Specs\n- RocksDB engine\n- Raft consensus",
          status: "delivered",
          timestamp: Date.now(),
        },
      ],
    };

    const output = await runner.run(reviewerNode, inputWithHandoff, createMockContext());

    expect(capturedInput).toContain("[UPSTREAM INPUTS]");
    expect(capturedInput).toContain("Upstream Context 1 (from node node-arch)");
    expect(capturedInput).toContain("RocksDB engine");
    expect(capturedInput).toContain("[ROLE: Reviewer]");
    expect(output.outputText).toContain("Review verdict: Approved");
  });

  it("parses structured output into metadata when emitted by the agent", async () => {
    const runner = new NodeRunner((agentType, options) => {
      const adapter = new MockAdapter(agentType, options);
      adapter.simulatedOutput = '```json\n{\n  "verdict": "pass",\n  "risks": []\n}\n```';
      return adapter;
    });

    const revNode: NodeRecord = {
      id: "node-rev-json",
      name: "Reviewer",
      kind: "agent",
      agentType: "claude-code",
      adapterKind: "terminal",
      workingDirectory: null,
      roleId: "reviewer",
      config: {
        outputSchema: {
          type: "object",
          properties: { verdict: { type: "string" }, risks: { type: "array" } },
        },
      },
      position: { x: 0, y: 0 },
    };

    const output = await runner.run(revNode, {}, createMockContext());

    expect(output.metadata?.structuredOutput).toEqual({ verdict: "pass", risks: [] });
  });

  it("runs standard agent nodes without roleId completely unchanged (regression safety)", async () => {
    let capturedInput = "";

    const runner = new NodeRunner((agentType, options) => {
      const adapter = new MockAdapter(agentType, options);
      const originalSend = adapter.send.bind(adapter);
      adapter.send = async (text: string) => {
        capturedInput = text;
        adapter.simulatedOutput = "Standard agent response";
        return originalSend(text);
      };
      return adapter;
    });

    const standardNode: NodeRecord = {
      id: "std-node-1",
      name: "Terminal Node",
      kind: "agent",
      agentType: "bash",
      adapterKind: "terminal",
      workingDirectory: null,
      config: {},
      position: { x: 0, y: 0 },
    };

    const output = await runner.run(
      standardNode,
      { directInput: "echo 'hello world'" },
      createMockContext(),
    );

    expect(capturedInput).toContain("echo 'hello world'");
    expect(capturedInput).not.toContain("[ROLE:");
    expect(output.outputText).toBe("Standard agent response");
  });

  it("executes a Manager role node compiling goal decomposition and planning contracts", async () => {
    let capturedInput = "";

    const runner = new NodeRunner((agentType, options) => {
      const adapter = new MockAdapter(agentType, options);
      const originalSend = adapter.send.bind(adapter);
      adapter.send = async (text: string) => {
        capturedInput = text;
        adapter.simulatedOutput = `\`\`\`json
{
  "goal": "Build an invoice management SaaS",
  "workflowIntent": "Decompose into PM specifications, Software Architecture, and Quality Review",
  "selectedRoles": ["manager", "product-manager", "software-architect", "reviewer"],
  "assumptions": ["Multi-tenant cloud architecture"],
  "risks": ["Data isolation between tenants"]
}
\`\`\``;
        return originalSend(text);
      };
      return adapter;
    });

    const managerNode: NodeRecord = {
      id: "node-mgr-1",
      name: "Manager",
      kind: "agent",
      agentType: "claude-code",
      adapterKind: "terminal",
      workingDirectory: null,
      roleId: "manager",
      config: {
        roleId: "manager",
        taskPrompt: "Decompose user goal: Build an invoice management SaaS",
      },
      position: { x: 0, y: 0 },
    };

    const output = await runner.run(
      managerNode,
      { directInput: "Build an invoice management SaaS" },
      createMockContext(),
    );

    expect(capturedInput).toContain("[ROLE: Manager]");
    expect(capturedInput).toContain("[PROHIBITED ACTIONS & BOUNDARIES]");
    expect(capturedInput).toContain("MUST NOT: Writing application source code");
    expect(capturedInput).toContain("[FAILURE CONDITIONS (REJECT IF)]");
    expect(capturedInput).toContain("[HANDOFF CONTRACT]");
    expect(capturedInput).toContain('Downstream Role: "product-manager"');
    expect(output.metadata?.roleId).toBe("manager");
    expect(output.metadata?.structuredOutput).toEqual({
      goal: "Build an invoice management SaaS",
      workflowIntent: "Decompose into PM specifications, Software Architecture, and Quality Review",
      selectedRoles: ["manager", "product-manager", "software-architect", "reviewer"],
      assumptions: ["Multi-tenant cloud architecture"],
      risks: ["Data isolation between tenants"],
    });
  });
});
