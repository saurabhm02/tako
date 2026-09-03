import { describe, expect, test } from "bun:test";
import { resolveAction, resolveActionsSequential, type CanvasAction, type ResolveContext } from "./commandLayer";
import type { TakoEdge, TakoNode } from "./types";
import type { AdapterManifestSummary, AgentProfile } from "../../shared/types";

function agentNode(id: string, name: string, agentType = "claude-code", overrides: Partial<TakoNode["data"]> = {}): TakoNode {
  return {
    id,
    type: "agentNode",
    position: { x: 100, y: 200 },
    data: {
      name,
      agentType,
      adapterKind: "terminal",
      workingDirectory: "/tmp/project",
      config: {},
      status: "idle",
      error: null,
      lastActivityAt: null,
      ...overrides,
    },
  };
}

function edge(id: string, source: string, target: string): TakoEdge {
  return { id, source, target, data: { autoApprove: false } };
}

const ADAPTERS: AdapterManifestSummary[] = [
  { agentType: "claude-code", displayName: "Claude Code", kind: "terminal", workingDirectoryRequired: true, installed: true },
  { agentType: "pi", displayName: "Pi", kind: "terminal", workingDirectoryRequired: true, installed: true },
];
const PROFILES: Record<string, AgentProfile[]> = {};

function ctx(nodes: TakoNode[] = [], edges: TakoEdge[] = [], selectedNodeId: string | null = null): ResolveContext {
  return { nodes, edges, adapters: ADAPTERS, profilesByAgentType: PROFILES, selectedNodeId };
}

describe("changeAgentType — selected-node and explicit-name resolution", () => {
  test("selected node + natural pronoun resolves via the existing $selected mechanism", () => {
    const nodes = [agentNode("a", "Apollo", "pi")];
    const result = resolveAction({ type: "changeAgentType", nodeRef: "this", agentType: "claude-code" }, ctx(nodes, [], "a"));
    expect(result).toMatchObject({
      ok: true,
      action: { kind: "changeAgentType", nodeId: "a", agentType: "claude-code", adapterKind: "terminal" },
      destructive: true,
    });
  });

  test("every listed pronoun variant resolves the same way", () => {
    const nodes = [agentNode("a", "Apollo", "pi")];
    for (const ref of ["this", "this node", "this agent", "selected node", "the selected node", "that"]) {
      const result = resolveAction({ type: "changeAgentType", nodeRef: ref, agentType: "claude-code" }, ctx(nodes, [], "a"));
      expect(result.ok).toBe(true);
    }
  });

  test("an explicit node name is honored even when a DIFFERENT node is selected — explicit always wins over selection", () => {
    const nodes = [agentNode("a", "Apollo", "pi"), agentNode("b", "Reviewer", "pi")];
    const result = resolveAction({ type: "changeAgentType", nodeRef: "Reviewer", agentType: "claude-code" }, ctx(nodes, [], "a"));
    expect(result).toMatchObject({ ok: true, action: { nodeId: "b" } });
  });

  test("no selection + a pronoun reference fails closed with a clear ask, never guesses", () => {
    const nodes = [agentNode("a", "Apollo", "pi")];
    const result = resolveAction({ type: "changeAgentType", nodeRef: "this", agentType: "claude-code" }, ctx(nodes, [], null));
    expect(result.ok).toBe(false);
  });

  test("multiple nodes selected (selectedNodeId is null, same as zero selected) also fails closed", () => {
    const nodes = [agentNode("a", "Apollo", "pi"), agentNode("b", "Reviewer", "pi")];
    // CanvasApp already collapses "more than one selected" to null before
    // this ever runs — this proves the resolver treats that exactly like
    // no selection, never picking one of the ambiguous candidates.
    const result = resolveAction({ type: "changeAgentType", nodeRef: "this", agentType: "claude-code" }, ctx(nodes, [], null));
    expect(result.ok).toBe(false);
  });

  test("an unknown/uninstalled agent type is rejected, never invented", () => {
    const nodes = [agentNode("a", "Apollo", "pi")];
    const result = resolveAction({ type: "changeAgentType", nodeRef: "Apollo", agentType: "gpt5" }, ctx(nodes));
    expect(result.ok).toBe(false);
  });

  test("is classified destructive — the current conversation is lost, same confirmation gate as removeNode", () => {
    const nodes = [agentNode("a", "Apollo", "pi")];
    const result = resolveAction({ type: "changeAgentType", nodeRef: "Apollo", agentType: "claude-code" }, ctx(nodes));
    expect(result.ok && result.destructive).toBe(true);
  });
});

describe("duplicateNode — fresh ids, no runtime state, sensible positioning", () => {
  test("copies agent type, working directory, and config; never copies status/error/lastActivityAt/lastCodeChange", () => {
    const source = agentNode("a", "Apollo", "claude-code", {
      config: { profileId: "saurabh" },
      status: "working",
      error: { kind: "crash", message: "boom", recoverable: false },
      lastActivityAt: 12345,
    });
    const result = resolveAction({ type: "duplicateNode", nodeRef: "Apollo" }, ctx([source]));
    expect(result.ok).toBe(true);
    if (!result.ok || result.action.kind !== "addNode") throw new Error("expected an addNode result");
    expect(result.action.agentType).toBe("claude-code");
    expect(result.action.adapterKind).toBe("terminal");
    expect(result.action.workingDirectory).toBe("/tmp/project");
    expect(result.action.config).toEqual({ profileId: "saurabh" });
    // The resolved action shape has no status/error/lastActivityAt fields
    // at all to copy into — proven structurally, not just by omission.
    expect(Object.keys(result.action)).not.toContain("status");
    expect(Object.keys(result.action)).not.toContain("error");
    expect(Object.keys(result.action)).not.toContain("lastActivityAt");
  });

  test("defaults to a sensible \"<name> copy\" name when none is given", () => {
    const result = resolveAction({ type: "duplicateNode", nodeRef: "Apollo" }, ctx([agentNode("a", "Apollo")]));
    expect(result.ok && result.action.kind === "addNode" && result.action.name).toBe("Apollo copy");
  });

  test("an explicit requested name is used instead of the default", () => {
    const result = resolveAction({ type: "duplicateNode", nodeRef: "Apollo", name: "Tester" }, ctx([agentNode("a", "Apollo")]));
    expect(result.ok && result.action.kind === "addNode" && result.action.name).toBe("Tester");
  });

  test("positioned near the source, not on top of it", () => {
    const source = agentNode("a", "Apollo");
    const result = resolveAction({ type: "duplicateNode", nodeRef: "Apollo" }, ctx([source]));
    expect(result.ok).toBe(true);
    if (!result.ok || result.action.kind !== "addNode") throw new Error("expected an addNode result");
    expect(result.action.position).toEqual({ x: source.position.x + 60, y: source.position.y + 60 });
  });

  test("never re-prompts for a working directory — workingDirectoryRequired is false since it's already decided", () => {
    const result = resolveAction({ type: "duplicateNode", nodeRef: "Apollo" }, ctx([agentNode("a", "Apollo")]));
    expect(result.ok && result.action.kind === "addNode" && result.action.workingDirectoryRequired).toBe(false);
  });

  test("duplicating the selected node via a pronoun works the same as by name", () => {
    const result = resolveAction({ type: "duplicateNode", nodeRef: "this" }, ctx([agentNode("a", "Apollo")], [], "a"));
    expect(result.ok).toBe(true);
  });

  test("is not destructive — creating a node is always safe, no confirmation needed", () => {
    const result = resolveAction({ type: "duplicateNode", nodeRef: "Apollo" }, ctx([agentNode("a", "Apollo")]));
    expect(result.ok && result.destructive).toBe(false);
  });

  test("a nonexistent source node fails closed", () => {
    const result = resolveAction({ type: "duplicateNode", nodeRef: "Ghost" }, ctx([agentNode("a", "Apollo")]));
    expect(result.ok).toBe(false);
  });

  test("an ambiguous (duplicate-named) source never guesses which one to copy", () => {
    const nodes = [agentNode("a", "Apollo"), agentNode("b", "Apollo")];
    const result = resolveAction({ type: "duplicateNode", nodeRef: "Apollo" }, ctx(nodes));
    expect(result.ok).toBe(false);
  });
});

describe("duplicateNode inside a multi-step request — reuses the existing temp-id mechanism with zero new code", () => {
  test("a later action in the same batch can reference the newly-duplicated node by the name it was given", () => {
    const source = agentNode("a", "Apollo", "claude-code");
    const actions: CanvasAction[] = [
      { type: "duplicateNode", nodeRef: "Apollo", name: "Tester" },
      { type: "connect", from: "Tester", to: "Apollo" },
      { type: "startNode", nodeRef: "Tester" },
    ];
    const results = resolveActionsSequential(actions, ctx([source]));
    expect(results.every((r) => r.ok)).toBe(true);

    const [duplicate, connect, start] = results;
    expect(duplicate.ok && duplicate.action.kind === "addNode" && duplicate.action.tempId).toBe("$new:0");
    expect(connect.ok && connect.action).toEqual({ kind: "connect", fromId: "$new:0", toId: "a" });
    expect(start.ok && start.action.kind === "startNode" && start.action.nodeId).toBe("$new:0");
  });

  test("multi-step natural command 'create a Claude agent called Apollo and connect Apollo to Reviewer'", () => {
    const source = agentNode("b", "Reviewer", "pi");
    const parsed = {
      ok: true as const,
      actions: [
        { type: "addNode" as const, agentType: "claude-code", name: "Apollo" },
        { type: "connect" as const, from: "Apollo", to: "Reviewer" },
      ],
    };
    const results = resolveActionsSequential(parsed.actions, ctx([source]));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0].ok && results[0].action.kind === "addNode" && results[0].action.name).toBe("Apollo");
    expect(results[1].ok && results[1].action.kind === "connect" && results[1].action.toId).toBe("b");
  });
});
