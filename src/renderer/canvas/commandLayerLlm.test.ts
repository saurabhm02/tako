import { describe, expect, test } from "bun:test";
import { answerCanvasQuery, buildCommandContext, referencesUnresolvedTempNode, resolveActionsSequential, substituteTempIds } from "./commandLayer";
import type { TakoEdge, TakoNode } from "./types";
import type { AdapterManifestSummary, AgentProfile, CanvasAction, NodeStatus } from "../../shared/types";

function edge(id: string, source: string, target: string): TakoEdge {
  return { id, source, target, data: { autoApprove: false } };
}

function agentNode(id: string, name: string, agentType = "claude-code", status: NodeStatus = "idle"): TakoNode {
  return {
    id,
    type: "agentNode",
    position: { x: 0, y: 0 },
    data: { name, agentType, adapterKind: "terminal", workingDirectory: "/tmp", config: {}, status, error: null, lastActivityAt: null },
  };
}

const ADAPTERS: AdapterManifestSummary[] = [
  { agentType: "claude-code", displayName: "Claude Code", kind: "terminal", workingDirectoryRequired: true, installed: true },
  { agentType: "pi", displayName: "Pi", kind: "terminal", workingDirectoryRequired: true, installed: true },
];
const PROFILES: Record<string, AgentProfile[]> = {};

function ctx(nodes: TakoNode[] = [], edges: TakoEdge[] = []) {
  return { nodes, edges, adapters: ADAPTERS, profilesByAgentType: PROFILES, selectedNodeId: null };
}

describe("buildCommandContext — exactly the minimum canvas state, never secrets/ids/paths", () => {
  test("includes name/agentType/status/profile by name, connections by name, installed types, selection, workflow name", () => {
    const apollo = agentNode("real-1", "Apollo", "claude-code", "working");
    apollo.data.config = { profileId: "saurabh" };
    const reviewer = agentNode("real-2", "Reviewer", "pi", "idle");
    const nodes = [apollo, reviewer];
    const edges: TakoEdge[] = [edge("e1", "real-1", "real-2")];
    const profiles: Record<string, AgentProfile[]> = { "claude-code": [{ id: "saurabh", label: "Saurabh" }] };

    const context = buildCommandContext(nodes, edges, ADAPTERS, profiles, "real-1", "Backend Review");

    expect(context).toEqual({
      nodes: [
        { name: "Apollo", agentType: "claude-code", status: "working", profile: "Saurabh" },
        { name: "Reviewer", agentType: "pi", status: "idle", profile: null },
      ],
      edges: [{ from: "Apollo", to: "Reviewer" }],
      installedAgents: ["claude-code", "pi"],
      selectedNodeName: "Apollo",
      workflowName: "Backend Review",
    });
  });

  test("never leaks a working directory, a raw profile id, or an internal node id", () => {
    const apollo = agentNode("real-1", "Apollo");
    apollo.data.workingDirectory = "/Users/saurabh/very/secret/project";
    apollo.data.config = { profileId: "saurabh" };
    const context = buildCommandContext([apollo], [], ADAPTERS, {}, null, "Untitled");
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("real-1");
    expect(serialized).not.toContain("saurabh"); // the raw profile id, not the label
  });

  test("no selection is null, never guessed", () => {
    const context = buildCommandContext([agentNode("a", "Apollo")], [], ADAPTERS, {}, null, "Untitled");
    expect(context.selectedNodeName).toBeNull();
  });
});

describe("resolveActionsSequential — a later action can reference a node an earlier action in the same batch creates", () => {
  test("create Apollo and Reviewer, connect them, then start Apollo", () => {
    const actions: CanvasAction[] = [
      { type: "addNode", agentType: "claude-code", name: "Apollo" },
      { type: "addNode", agentType: "pi", name: "Reviewer" },
      { type: "connect", from: "Apollo", to: "Reviewer" },
      { type: "startNode", nodeRef: "Apollo" },
    ];
    const results = resolveActionsSequential(actions, ctx());
    expect(results.every((r) => r.ok)).toBe(true);

    const [addApollo, addReviewer, connect, start] = results;
    expect(addApollo.ok && addApollo.action.kind === "addNode" && addApollo.action.tempId).toBe("$new:0");
    expect(addReviewer.ok && addReviewer.action.kind === "addNode" && addReviewer.action.tempId).toBe("$new:1");
    expect(connect.ok && connect.action).toEqual({ kind: "connect", fromId: "$new:0", toId: "$new:1" });
    expect(start.ok && start.action.kind === "startNode" && start.action.nodeId).toBe("$new:0");
  });

  test("a real pre-existing node still resolves normally alongside a same-batch virtual one", () => {
    const nodes = [agentNode("real-1", "Existing")];
    const actions: CanvasAction[] = [
      { type: "addNode", agentType: "claude-code", name: "Apollo" },
      { type: "connect", from: "Apollo", to: "Existing" },
    ];
    const results = resolveActionsSequential(actions, ctx(nodes));
    expect(results[1].ok && results[1].action).toEqual({ kind: "connect", fromId: "$new:0", toId: "real-1" });
  });

  test("referencing a node that was never created (in this batch or on the canvas) still fails, no guessing", () => {
    const actions: CanvasAction[] = [{ type: "connect", from: "Apollo", to: "Ghost" }];
    const results = resolveActionsSequential(actions, ctx());
    expect(results[0].ok).toBe(false);
  });

  test("one unresolved action does not corrupt resolution of the rest of the batch (each is independent at resolve time; execution enforces all-or-nothing)", () => {
    const actions: CanvasAction[] = [{ type: "stopNode", nodeRef: "Nonexistent" }, { type: "stopAll" }];
    const results = resolveActionsSequential(actions, ctx());
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(true);
  });
});

describe("substituteTempIds — swaps a virtual id for the real one after real creation", () => {
  test("a connect referencing two temp ids is substituted once both are known", () => {
    const map = new Map([["$new:0", "real-apollo"], ["$new:1", "real-reviewer"]]);
    const action = substituteTempIds({ kind: "connect", fromId: "$new:0", toId: "$new:1" }, map);
    expect(action).toEqual({ kind: "connect", fromId: "real-apollo", toId: "real-reviewer" });
  });

  test("an id with no matching temp entry passes through unchanged (already real)", () => {
    const action = substituteTempIds({ kind: "stopNode", nodeId: "real-id" }, new Map());
    expect(action).toEqual({ kind: "stopNode", nodeId: "real-id" });
  });

  test("disconnect/addNode/stopAll/clearAll carry no substitutable node reference and pass through untouched", () => {
    expect(substituteTempIds({ kind: "stopAll" }, new Map())).toEqual({ kind: "stopAll" });
    expect(substituteTempIds({ kind: "disconnect", edgeId: "e1" }, new Map([["$new:0", "x"]]))).toEqual({ kind: "disconnect", edgeId: "e1" });
  });

  test("a temp id with no entry yet (its addNode hasn't executed, e.g. a cancelled folder picker) is left as the placeholder, not silently dropped", () => {
    const action = substituteTempIds({ kind: "stopNode", nodeId: "$new:0" }, new Map());
    expect(action).toEqual({ kind: "stopNode", nodeId: "$new:0" });
  });
});

describe("referencesUnresolvedTempNode — the all-or-nothing guard for a failure that happens during execution, not just at resolve time", () => {
  test("a connect still carrying a temp id (its addNode never actually ran) is caught", () => {
    expect(referencesUnresolvedTempNode({ kind: "connect", fromId: "$new:0", toId: "real-id" })).toBe(true);
  });

  test("a fully-substituted real action is not flagged", () => {
    expect(referencesUnresolvedTempNode({ kind: "connect", fromId: "real-a", toId: "real-b" })).toBe(false);
    expect(referencesUnresolvedTempNode({ kind: "stopNode", nodeId: "real-id" })).toBe(false);
  });

  test("addNode/stopAll/clearAll/disconnect never reference a node id and are never flagged", () => {
    expect(referencesUnresolvedTempNode({ kind: "stopAll" })).toBe(false);
    expect(referencesUnresolvedTempNode({ kind: "clearAll" })).toBe(false);
    expect(referencesUnresolvedTempNode({ kind: "disconnect", edgeId: "e1" })).toBe(false);
    expect(
      referencesUnresolvedTempNode({ kind: "addNode", agentType: "pi", adapterKind: "terminal", workingDirectoryRequired: true, name: "X" }),
    ).toBe(false);
  });
});

describe("answerCanvasQuery — computed from real renderer state, never fabricated", () => {
  test("countAgents counts only agent nodes", () => {
    const nodes = [agentNode("a", "Apollo"), agentNode("b", "Reviewer")];
    expect(answerCanvasQuery({ type: "countAgents" }, nodes)).toBe("You have 2 agents.");
  });

  test("countAgents singular vs zero wording", () => {
    expect(answerCanvasQuery({ type: "countAgents" }, [agentNode("a", "Apollo")])).toBe("You have 1 agent.");
    expect(answerCanvasQuery({ type: "countAgents" }, [])).toBe("You have no agents on the canvas.");
  });

  test("listByStatus running lists only nodes in the running bucket", () => {
    const nodes = [agentNode("a", "Apollo", "claude-code", "working"), agentNode("b", "Reviewer", "pi", "idle")];
    expect(answerCanvasQuery({ type: "listByStatus", bucket: "running" }, nodes)).toBe("Running: Apollo.");
  });

  test("listByStatus waiting matches handoff_ready, the real 'needs your review' state", () => {
    const nodes = [agentNode("a", "Apollo", "claude-code", "handoff_ready")];
    expect(answerCanvasQuery({ type: "listByStatus", bucket: "waiting" }, nodes)).toBe("Waiting: Apollo.");
  });

  test("no matches produces a clear negative answer, not an empty list", () => {
    const nodes = [agentNode("a", "Apollo", "claude-code", "idle")];
    expect(answerCanvasQuery({ type: "listByStatus", bucket: "error" }, nodes)).toBe("No agents are in an error state.");
  });
});
