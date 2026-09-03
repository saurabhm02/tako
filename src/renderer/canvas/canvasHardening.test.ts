import { describe, expect, it } from "bun:test";
import { sanitizeSecretText } from "../../shared/sanitize";
import { validateWorkflow } from "../../shared/workflowValidation";
import { duplicateSnapshotWithFreshIds } from "./types";
import { interpret, resolveAction, type ResolveContext } from "./commandLayer";
import type { AdapterManifestSummary, ConnectionRecord, NodeRecord, WorkflowSnapshot } from "../../shared/types";
import { WorkflowGraphEngine } from "../../main/runtime/WorkflowGraphEngine";

describe("Canvas MVP Hardening & Product Completeness", () => {
  describe("Security & Secret Sanitization", () => {
    it("sanitizes OpenAI API keys", () => {
      const msg = "Error communicating with upstream API: sk-proj-1234567890abcdef1234567890 was rejected";
      expect(sanitizeSecretText(msg)).toBe("Error communicating with upstream API: sk-*** was rejected");
    });

    it("sanitizes Bearer authorization headers", () => {
      const msg = "Request failed with Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      expect(sanitizeSecretText(msg)).toBe("Request failed with Authorization: Bearer ***");
    });

    it("sanitizes Google AI API keys", () => {
      const msg = "API key AIzaSyA1234567890abcdef1234567890abcdef is invalid";
      expect(sanitizeSecretText(msg)).toBe("API key AIza*** is invalid");
    });

    it("sanitizes GitHub and AWS credentials", () => {
      const msg = "ghp_123456789012345678901234567890123456 and AKIAIOSFODNN7EXAMPLE";
      expect(sanitizeSecretText(msg)).toBe("ghp_*** and AKIA***");
    });
  });

  describe("Workflow Validation Layer", () => {
    it("catches empty workflows", () => {
      const wf: WorkflowSnapshot = { id: "w1", name: "Empty", nodes: [], connections: [] };
      const res = validateWorkflow(wf);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("Workflow has no nodes");
    });

    it("catches workflows with only passive note nodes", () => {
      const wf: WorkflowSnapshot = {
        id: "w1",
        name: "Notes Only",
        nodes: [
          {
            id: "note-1",
            name: "Ideas",
            kind: "note",
            agentType: "note",
            adapterKind: "terminal",
            workingDirectory: null,
            config: { text: "Todo" },
            position: { x: 0, y: 0 },
          },
        ],
        connections: [],
      };
      const res = validateWorkflow(wf);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("contains only passive notes");
    });

    it("catches uninstalled external agent CLIs", () => {
      const wf: WorkflowSnapshot = {
        id: "w1",
        name: "My Workflow",
        nodes: [
          {
            id: "node-1",
            name: "Gemini Worker",
            kind: "agent",
            agentType: "gemini",
            adapterKind: "terminal",
            workingDirectory: "/tmp",
            config: {},
            position: { x: 0, y: 0 },
          },
        ],
        connections: [],
      };
      const res = validateWorkflow(wf, { installedAgentTypes: new Set(["claude-code", "bash"]) });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("is not installed or not available on PATH");
    });

    it("catches broken connections referencing missing nodes", () => {
      const wf: WorkflowSnapshot = {
        id: "w1",
        name: "Pipeline",
        nodes: [
          {
            id: "node-1",
            name: "Claude",
            kind: "agent",
            agentType: "claude-code",
            adapterKind: "terminal",
            workingDirectory: "/tmp",
            config: {},
            position: { x: 0, y: 0 },
          },
        ],
        connections: [{ id: "c1", fromNodeId: "node-1", toNodeId: "non-existent", autoApprove: false }],
      };
      const res = validateWorkflow(wf);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("references a missing target node");
    });

    it("catches self loops", () => {
      const wf: WorkflowSnapshot = {
        id: "w1",
        name: "Pipeline",
        nodes: [
          {
            id: "node-1",
            name: "Claude",
            kind: "agent",
            agentType: "claude-code",
            adapterKind: "terminal",
            workingDirectory: "/tmp",
            config: {},
            position: { x: 0, y: 0 },
          },
        ],
        connections: [{ id: "c1", fromNodeId: "node-1", toNodeId: "node-1", autoApprove: false }],
      };
      const res = validateWorkflow(wf);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("Self-connection detected");
    });
  });

  describe("Duplicate Snapshot Mechanics", () => {
    it("generates fresh node and connection IDs without altering configuration", () => {
      const origNodes: NodeRecord[] = [
        {
          id: "node-orig-1",
          name: "Analyzer",
          kind: "agent",
          agentType: "claude-code",
          adapterKind: "terminal",
          workingDirectory: "/workspace",
          config: { taskPrompt: "Analyze the codebase" },
          position: { x: 100, y: 100 },
        },
        {
          id: "node-orig-2",
          name: "Reviewer",
          kind: "agent",
          agentType: "codex",
          adapterKind: "terminal",
          workingDirectory: "/workspace",
          config: { taskPrompt: "Review changes" },
          position: { x: 300, y: 100 },
        },
      ];
      const origConns: ConnectionRecord[] = [
        {
          id: "conn-orig-1",
          fromNodeId: "node-orig-1",
          toNodeId: "node-orig-2",
          autoApprove: true,
        },
      ];

      const { nodes, connections } = duplicateSnapshotWithFreshIds(origNodes, origConns);

      expect(nodes.length).toBe(2);
      expect(connections.length).toBe(1);

      // Verify fresh IDs
      expect(nodes[0].id).not.toBe("node-orig-1");
      expect(nodes[1].id).not.toBe("node-orig-2");
      expect(connections[0].id).not.toBe("conn-orig-1");

      // Verify connection remapping
      expect(connections[0].fromNodeId).toBe(nodes[0].id);
      expect(connections[0].toNodeId).toBe(nodes[1].id);
      expect(connections[0].autoApprove).toBe(true);

      // Verify configs preserved
      expect(nodes[0].config.taskPrompt).toBe("Analyze the codebase");
      expect(nodes[1].config.taskPrompt).toBe("Review changes");
    });
  });

  describe("Task Prompt Integration in Execution", () => {
    it("feeds taskPrompt from node config as directInput when starting engine", async () => {
      const wf = {
        id: "wf-prompt",
        name: "Prompt Test",
        nodes: [
          {
            id: "n1",
            name: "Agent 1",
            kind: "agent" as const,
            agentType: "claude-code",
            adapterKind: "terminal" as const,
            workingDirectory: "/tmp",
            config: { taskPrompt: "Run unit tests and check coverage" },
            position: { x: 0, y: 0 },
          },
        ],
        connections: [],
      };

      let capturedInput = "";
      const engine = new WorkflowGraphEngine(
        wf,
        {
          nodeRunner: {
            async run(_node, input) {
              capturedInput = input.directInput ?? "";
              return { outputText: "Done" };
            },
          },
          onEvent: () => {},
        },
        "exec-test",
        { n1: "Run unit tests and check coverage" },
      );

      const run = await engine.execute();
      expect(run.status).toBe("completed");
      expect(capturedInput).toBe("Run unit tests and check coverage");
      expect(run.nodeRuns.n1.input?.directInput).toBe("Run unit tests and check coverage");
    });
  });

  describe("Command Bar Canvas & Viewport Commands", () => {
    const mockAdapters: AdapterManifestSummary[] = [
      { agentType: "claude-code", displayName: "Claude Code", kind: "terminal", workingDirectoryRequired: true, installed: true },
      { agentType: "bash", displayName: "Terminal", kind: "terminal", workingDirectoryRequired: false, installed: true },
    ];

    const ctx: ResolveContext = {
      nodes: [],
      edges: [],
      adapters: mockAdapters,
      profilesByAgentType: {},
      selectedNodeId: null,
    };

    it("interprets 'fit view' command", () => {
      const parsed = interpret("fit view");
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.actions[0].type).toBe("fitView");
        const resolved = resolveAction(parsed.actions[0], ctx);
        expect(resolved.ok).toBe(true);
        if (resolved.ok) {
          expect(resolved.action.kind).toBe("fitView");
        }
      }
    });

    it("interprets 'center canvas' command", () => {
      const parsed = interpret("center canvas");
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.actions[0].type).toBe("fitView");
      }
    });

    it("interprets 'history' command", () => {
      const parsed = interpret("open history");
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.actions[0].type).toBe("openHistory");
        const resolved = resolveAction(parsed.actions[0], ctx);
        expect(resolved.ok).toBe(true);
        if (resolved.ok) {
          expect(resolved.action.kind).toBe("openHistory");
        }
      }
    });

    it("interprets 'activity' command", () => {
      const parsed = interpret("activity timeline");
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.actions[0].type).toBe("openActivity");
        const resolved = resolveAction(parsed.actions[0], ctx);
        expect(resolved.ok).toBe(true);
        if (resolved.ok) {
          expect(resolved.action.kind).toBe("openActivity");
        }
      }
    });
  });
});
