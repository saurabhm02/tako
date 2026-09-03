import { describe, expect, test } from "bun:test";
import { interpret, resolveAction, type ResolveContext } from "./commandLayer";
import type { TakoEdge, TakoNode } from "./types";
import type { AdapterManifestSummary, AgentProfile } from "../../shared/types";

function agentNode(id: string, name: string, agentType = "claude-code"): TakoNode {
  return {
    id,
    type: "agentNode",
    position: { x: 0, y: 0 },
    data: {
      name,
      agentType,
      adapterKind: "terminal",
      workingDirectory: "/tmp",
      config: {},
      status: "idle",
      error: null,
      lastActivityAt: null,
    },
  };
}

function edge(id: string, source: string, target: string): TakoEdge {
  return { id, source, target, data: { autoApprove: false } };
}

const ADAPTERS: AdapterManifestSummary[] = [
  { agentType: "claude-code", displayName: "Claude Code", kind: "terminal", workingDirectoryRequired: true, installed: true },
  { agentType: "pi", displayName: "Pi", kind: "terminal", workingDirectoryRequired: true, installed: true },
  { agentType: "codex", displayName: "Codex", kind: "terminal", workingDirectoryRequired: true, installed: false }, // not installed
];

const PROFILES: Record<string, AgentProfile[]> = {
  "claude-code": [{ id: "saurabh", label: "Saurabh" }],
};

function ctx(nodes: TakoNode[] = [], edges: TakoEdge[] = [], selectedNodeId: string | null = null): ResolveContext {
  return { nodes, edges, adapters: ADAPTERS, profilesByAgentType: PROFILES, selectedNodeId };
}

// ---- interpret() ----

describe("interpret — every supported command", () => {
  test("add", () => {
    expect(interpret("Add a Pi researcher")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "Pi", name: "researcher" }],
    });
  });

  test("add with no trailing name", () => {
    expect(interpret("Add Pi")).toEqual({ ok: true, actions: [{ type: "addNode", agentType: "Pi", name: undefined }] });
  });

  test("connect", () => {
    expect(interpret("Connect Apollo to Reviewer")).toEqual({
      ok: true,
      actions: [{ type: "connect", from: "Apollo", to: "Reviewer" }],
    });
  });

  test("disconnect", () => {
    expect(interpret("Disconnect Apollo from Reviewer")).toEqual({
      ok: true,
      actions: [{ type: "disconnect", from: "Apollo", to: "Reviewer" }],
    });
  });

  test("rename", () => {
    expect(interpret("Rename Apollo to Code Reviewer")).toEqual({
      ok: true,
      actions: [{ type: "renameNode", nodeRef: "Apollo", newName: "Code Reviewer" }],
    });
  });

  test("switch (profile)", () => {
    expect(interpret("Switch Orion to Saurabh")).toEqual({
      ok: true,
      actions: [{ type: "setProfile", nodeRef: "Orion", profileRef: "Saurabh" }],
    });
  });

  test("remove/delete", () => {
    expect(interpret("Remove Apollo")).toEqual({ ok: true, actions: [{ type: "removeNode", nodeRef: "Apollo" }] });
    expect(interpret("Delete Apollo")).toEqual({ ok: true, actions: [{ type: "removeNode", nodeRef: "Apollo" }] });
  });

  test("stop all", () => {
    expect(interpret("Stop all agents")).toEqual({ ok: true, actions: [{ type: "stopAll" }] });
    expect(interpret("stop all")).toEqual({ ok: true, actions: [{ type: "stopAll" }] });
  });

  test("clear all", () => {
    expect(interpret("Clear all")).toEqual({ ok: true, actions: [{ type: "clearAll" }] });
    expect(interpret("Clear the canvas")).toEqual({ ok: true, actions: [{ type: "clearAll" }] });
  });
});

describe("interpret — compound commands", () => {
  test("two commands joined by 'and' become two actions", () => {
    expect(interpret("Add a Pi researcher and add a Claude reviewer")).toEqual({
      ok: true,
      actions: [
        { type: "addNode", agentType: "Pi", name: "researcher" },
        { type: "addNode", agentType: "Claude", name: "reviewer" },
      ],
    });
  });

  test("semicolon-separated also splits", () => {
    const result = interpret("Stop all; clear all");
    expect(result.ok).toBe(true);
    expect(result.ok && result.actions).toEqual([{ type: "stopAll" }, { type: "clearAll" }]);
  });
});

describe("interpret — malformed/unsupported commands never execute", () => {
  test("gibberish fails to parse", () => {
    expect(interpret("do a backflip")).toEqual({ ok: false, reason: 'I don\'t understand "do a backflip".' });
  });

  test("empty input fails to parse", () => {
    expect(interpret("   ")).toEqual({ ok: false, reason: "Type a command." });
  });

  test("one bad segment fails the whole compound command, not just that segment", () => {
    const result = interpret("Stop all and do a backflip");
    expect(result.ok).toBe(false);
  });
});

// ---- resolveAction() ----

describe("resolveAction — addNode", () => {
  test("resolves an installed agent by display-name prefix, case-insensitive", () => {
    const result = resolveAction({ type: "addNode", agentType: "pi", name: "Researcher" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.ok && result.action).toEqual({
      kind: "addNode",
      agentType: "pi",
      adapterKind: "terminal",
      workingDirectoryRequired: true,
      name: "Researcher",
    });
    expect(result.ok && result.destructive).toBe(false);
  });

  test("falls back to the agent's display name when no name was given", () => {
    const result = resolveAction({ type: "addNode", agentType: "pi" }, ctx());
    expect(result.ok && result.action.kind === "addNode" && result.action.name).toBe("Pi");
  });

  test("a not-installed agent is rejected, never silently added", () => {
    const result = resolveAction({ type: "addNode", agentType: "codex" }, ctx());
    expect(result).toEqual({ ok: false, description: "Codex CLI is not installed or available on PATH on this machine." });
  });

  test("an unknown agent never gets invented", () => {
    const result = resolveAction({ type: "addNode", agentType: "made-up-agent" }, ctx());
    expect(result).toEqual({ ok: false, description: 'No agent matches "made-up-agent".' });
  });
});

describe("resolveAction — node lookup: exact case-insensitive, no guessing", () => {
  test("case-insensitive exact match resolves", () => {
    const nodes = [agentNode("n1", "Apollo")];
    const result = resolveAction({ type: "removeNode", nodeRef: "apollo" }, ctx(nodes));
    expect(result).toEqual({ ok: true, action: { kind: "removeNode", nodeId: "n1" }, description: 'Remove "Apollo".', destructive: true });
  });

  test("unknown node name fails, never guesses a close match", () => {
    const nodes = [agentNode("n1", "Apollo")];
    const result = resolveAction({ type: "removeNode", nodeRef: "Apoloo" }, ctx(nodes));
    expect(result).toEqual({ ok: false, description: 'No node named "Apoloo".' });
  });

  test("duplicate names ask instead of picking one", () => {
    const nodes = [agentNode("n1", "Apollo"), agentNode("n2", "Apollo")];
    const result = resolveAction({ type: "removeNode", nodeRef: "Apollo" }, ctx(nodes));
    expect(result).toEqual({ ok: false, description: 'Multiple nodes are named "Apollo" — rename one first.' });
  });

  test("a raw node id typed by the user is never accepted as a name match", () => {
    const nodes = [agentNode("n1", "Apollo")];
    const result = resolveAction({ type: "removeNode", nodeRef: "n1" }, ctx(nodes));
    expect(result.ok).toBe(false); // "n1" is the id, not the display name — must not resolve
  });
});

describe("resolveAction — connect/disconnect", () => {
  test("connect resolves both ends to real ids", () => {
    const nodes = [agentNode("a", "Apollo"), agentNode("b", "Reviewer")];
    const result = resolveAction({ type: "connect", from: "Apollo", to: "Reviewer" }, ctx(nodes));
    expect(result).toEqual({
      ok: true,
      action: { kind: "connect", fromId: "a", toId: "b" },
      description: 'Connect "Apollo" → "Reviewer".',
      destructive: false,
    });
  });

  test("connecting a node to itself is rejected", () => {
    const nodes = [agentNode("a", "Apollo")];
    const result = resolveAction({ type: "connect", from: "Apollo", to: "Apollo" }, ctx(nodes));
    expect(result.ok).toBe(false);
  });

  test("disconnect requires a real existing edge, classified destructive", () => {
    const nodes = [agentNode("a", "Apollo"), agentNode("b", "Reviewer")];
    const edges = [edge("e1", "a", "b")];
    const result = resolveAction({ type: "disconnect", from: "Apollo", to: "Reviewer" }, ctx(nodes, edges));
    expect(result).toEqual({
      ok: true,
      action: { kind: "disconnect", edgeId: "e1" },
      description: 'Disconnect "Apollo" → "Reviewer".',
      destructive: true,
    });
  });

  test("disconnecting two nodes with no edge between them fails, never invents one", () => {
    const nodes = [agentNode("a", "Apollo"), agentNode("b", "Reviewer")];
    const result = resolveAction({ type: "disconnect", from: "Apollo", to: "Reviewer" }, ctx(nodes, []));
    expect(result.ok).toBe(false);
  });
});

describe("resolveAction — setProfile validates against real profile data", () => {
  test("a real profile for that node's agent type resolves", () => {
    const nodes = [agentNode("a", "Orion", "claude-code")];
    const result = resolveAction({ type: "setProfile", nodeRef: "Orion", profileRef: "saurabh" }, ctx(nodes));
    expect(result).toEqual({
      ok: true,
      action: { kind: "setProfile", nodeId: "a", profileId: "saurabh" },
      description: 'Switch "Orion" to profile "Saurabh".',
      destructive: false,
    });
  });

  test("a profile that doesn't exist for that agent is rejected", () => {
    const nodes = [agentNode("a", "Orion", "claude-code")];
    const result = resolveAction({ type: "setProfile", nodeRef: "Orion", profileRef: "not-a-real-profile" }, ctx(nodes));
    expect(result.ok).toBe(false);
  });

  test("an agent type with no profiles at all is rejected, not silently accepted", () => {
    const nodes = [agentNode("a", "Freyr", "pi")]; // "pi" has no entry in PROFILES
    const result = resolveAction({ type: "setProfile", nodeRef: "Freyr", profileRef: "anything" }, ctx(nodes));
    expect(result.ok).toBe(false);
  });
});

describe("resolveAction — destructive classification", () => {
  test("removeNode, disconnect, stopAll, clearAll are destructive", () => {
    const nodes = [agentNode("a", "Apollo"), agentNode("b", "Reviewer")];
    const edges = [edge("e1", "a", "b")];
    const results = [
      resolveAction({ type: "removeNode", nodeRef: "Apollo" }, ctx(nodes)),
      resolveAction({ type: "disconnect", from: "Apollo", to: "Reviewer" }, ctx(nodes, edges)),
      resolveAction({ type: "stopAll" }, ctx()),
      resolveAction({ type: "clearAll" }, ctx()),
    ];
    for (const r of results) expect(r.ok && r.destructive).toBe(true);
  });

  test("addNode, renameNode, connect, setProfile are not destructive", () => {
    const nodes = [agentNode("a", "Apollo"), agentNode("b", "Reviewer"), agentNode("c", "Orion", "claude-code")];
    const results = [
      resolveAction({ type: "addNode", agentType: "pi" }, ctx()),
      resolveAction({ type: "renameNode", nodeRef: "Apollo", newName: "X" }, ctx(nodes)),
      resolveAction({ type: "connect", from: "Apollo", to: "Reviewer" }, ctx(nodes)),
      resolveAction({ type: "setProfile", nodeRef: "Orion", profileRef: "Saurabh" }, ctx(nodes)),
    ];
    for (const r of results) expect(r.ok && r.destructive).toBe(false);
  });

  test("startNode, stopNode, restartNode, markDone are not destructive (reversible, session-preserving)", () => {
    const nodes = [agentNode("a", "Apollo")];
    const results = [
      resolveAction({ type: "startNode", nodeRef: "Apollo" }, ctx(nodes)),
      resolveAction({ type: "stopNode", nodeRef: "Apollo" }, ctx(nodes)),
      resolveAction({ type: "restartNode", nodeRef: "Apollo" }, ctx(nodes)),
      resolveAction({ type: "markDone", nodeRef: "Apollo" }, ctx(nodes)),
    ];
    for (const r of results) expect(r.ok && r.destructive).toBe(false);
  });
});

describe("interpret — node lifecycle commands", () => {
  test("start/stop/restart/mark done", () => {
    expect(interpret("Start Apollo")).toEqual({ ok: true, actions: [{ type: "startNode", nodeRef: "Apollo" }] });
    expect(interpret("Stop Apollo")).toEqual({ ok: true, actions: [{ type: "stopNode", nodeRef: "Apollo" }] });
    expect(interpret("Restart Apollo")).toEqual({ ok: true, actions: [{ type: "restartNode", nodeRef: "Apollo" }] });
    expect(interpret("Mark Apollo done")).toEqual({ ok: true, actions: [{ type: "markDone", nodeRef: "Apollo" }] });
  });

  // The real regex-collision risk: "stop all" must never be parsed as
  // stopNode with nodeRef "all".
  test("'stop all' is never mistaken for stopping a node literally named 'all'", () => {
    expect(interpret("Stop all")).toEqual({ ok: true, actions: [{ type: "stopAll" }] });
    expect(interpret("Stop all agents")).toEqual({ ok: true, actions: [{ type: "stopAll" }] });
    expect(interpret("Stop Apollo")).toEqual({ ok: true, actions: [{ type: "stopNode", nodeRef: "Apollo" }] });
  });
});

describe("interpret — natural phrasing variants", () => {
  test("'create' is an alias for 'add'", () => {
    expect(interpret("Create a Claude reviewer")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "Claude", name: "reviewer" }],
    });
  });

  test("'with' is an alias for 'to' in connect", () => {
    expect(interpret("Connect Apollo with Reviewer")).toEqual({
      ok: true,
      actions: [{ type: "connect", from: "Apollo", to: "Reviewer" }],
    });
  });

  test("create a Claude agent called Apollo extracts Apollo as name", () => {
    expect(interpret("create a claude agent called Apollo")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "claude", name: "Apollo" }],
    });
  });

  test("create Apollo using Claude extracts Apollo as name and Claude as agentType", () => {
    expect(interpret("create Apollo using Claude")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "Claude", name: "Apollo" }],
    });
  });

  test("add a Claude agent named Apollo extracts Apollo as name", () => {
    expect(interpret("add a Claude agent named Apollo")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "Claude", name: "Apollo" }],
    });
  });

  test("I want a Claude agent called Apollo extracts Apollo as name", () => {
    expect(interpret("I want a Claude agent called Apollo")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "Claude", name: "Apollo" }],
    });
  });

  test("make Apollo a Claude agent extracts Apollo as name and Claude as agentType", () => {
    expect(interpret("make Apollo a Claude agent")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "Claude", name: "Apollo" }],
    });
  });

  test("create a claude agent called appolo extracts appolo as name", () => {
    expect(interpret("create a claude agent called appolo")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "claude", name: "appolo" }],
    });
  });

  test("create Apollo as a Claude agent extracts Apollo as name and Claude as agentType", () => {
    expect(interpret("create Apollo as a Claude agent")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "Claude", name: "Apollo" }],
    });
  });

  test("make a Claude agent named Apollo extracts Apollo as name and Claude as agentType", () => {
    expect(interpret("make a Claude agent named Apollo")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "Claude", name: "Apollo" }],
    });
  });

  test("create an agent called Apollo using Claude Code extracts Apollo as name and Claude Code as agentType", () => {
    expect(interpret("create an agent called Apollo using Claude Code")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "Claude Code", name: "Apollo" }],
    });
  });

  test("create a Claude Code agent called Apollo extracts Apollo as name and Claude Code as agentType", () => {
    expect(interpret("create a Claude Code agent called Apollo")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "Claude Code", name: "Apollo" }],
    });
  });

  test("create claude code named Apollo extracts Apollo as name and claude code as agentType", () => {
    expect(interpret("create claude code named Apollo")).toEqual({
      ok: true,
      actions: [{ type: "addNode", agentType: "claude code", name: "Apollo" }],
    });
  });
});

describe("interpret — pronoun references become the selected-node sentinel", () => {
  test("it / this / that / this node / this agent all normalize the same way", () => {
    for (const word of ["it", "this", "that", "this node", "that agent"]) {
      expect(interpret(`Stop ${word}`)).toEqual({ ok: true, actions: [{ type: "stopNode", nodeRef: "$selected" }] });
    }
  });

  test("pronoun works in both ref positions of a two-node command", () => {
    expect(interpret("Connect it to Reviewer")).toEqual({
      ok: true,
      actions: [{ type: "connect", from: "$selected", to: "Reviewer" }],
    });
  });

  test("a real node literally named 'it' is not a pronoun word by coincidence", () => {
    // "it" is reserved; a node named that must be addressed some other way
    // (rename) — documented ceiling, not a bug: real node names colliding
    // with a reserved pronoun is vanishingly unlikely in practice.
    expect(interpret("Rename it to Something")).toEqual({
      ok: true,
      actions: [{ type: "renameNode", nodeRef: "$selected", newName: "Something" }],
    });
  });
});

describe("resolveAction — selected-node context", () => {
  test("a pronoun resolves to the single selected node", () => {
    const nodes = [agentNode("a", "Apollo"), agentNode("b", "Reviewer")];
    const result = resolveAction({ type: "stopNode", nodeRef: "$selected" }, ctx(nodes, [], "a"));
    expect(result).toEqual({ ok: true, action: { kind: "stopNode", nodeId: "a" }, description: 'Stop "Apollo".', destructive: false });
  });

  test("no selection at all fails, never guesses", () => {
    const nodes = [agentNode("a", "Apollo")];
    const result = resolveAction({ type: "stopNode", nodeRef: "$selected" }, ctx(nodes, [], null));
    expect(result.ok).toBe(false);
  });

  test("a pronoun never falls back to name-matching a node literally named '$selected'", () => {
    const nodes = [agentNode("a", "$selected")];
    const result = resolveAction({ type: "stopNode", nodeRef: "$selected" }, ctx(nodes, [], null));
    expect(result.ok).toBe(false); // no selection -> fails, does not name-match "a"
  });
});
