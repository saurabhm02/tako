import { describe, expect, test } from "bun:test";
import {
  buildCreatableNodeList,
  findNextNodeForShortcut,
  matchNodeShortcut,
  pickAvailableShortcut,
  randomName,
  resolveNodeShortcuts,
  type CreatableNodeItem,
  type RawNodeItemInput,
} from "./AddNodePopover";
import { DEFAULT_OMNI_ACCENT_COLOR, getAgentAccentColor, type TakoNode } from "./types";
import type { AdapterManifestSummary } from "../../shared/types";

function mockAgentNode(id: string, name: string, agentType: string, lastActivityAt: number | null = null): TakoNode {
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
      lastActivityAt,
    },
  };
}

function mockNoteNode(id: string, name: string): TakoNode {
  return {
    id,
    type: "noteNode",
    position: { x: 0, y: 0 },
    data: {
      name,
      config: { text: "" },
    },
  };
}

describe("AddNodePopover — Dynamic Node Library & Availability", () => {
  const sampleManifest: AdapterManifestSummary[] = [
    {
      agentType: "claude-code",
      displayName: "Claude Code",
      kind: "terminal",
      workingDirectoryRequired: true,
      installed: true,
      shortcut: "C",
      order: 1,
      brandColor: "#d97757",
    },
    {
      agentType: "pi",
      displayName: "Pi",
      kind: "terminal",
      workingDirectoryRequired: true,
      installed: true,
      shortcut: "P",
      order: 2,
      brandColor: "#a78bfa",
    },
    {
      agentType: "codex",
      displayName: "Codex",
      kind: "terminal",
      workingDirectoryRequired: true,
      installed: false, // NOT installed
      shortcut: "X",
      order: 3,
      brandColor: "#10a37f",
    },
    {
      agentType: "bash",
      displayName: "Terminal",
      kind: "terminal",
      workingDirectoryRequired: true,
      installed: true,
      shortcut: "T",
      order: 4,
      brandColor: "#38bdf8",
    },
    {
      agentType: "codex-chatgpt",
      displayName: "ChatGPT",
      kind: "session",
      workingDirectoryRequired: false,
      installed: false, // NOT installed
      shortcut: "G",
      order: 5,
      brandColor: "#10a37f",
    },
    {
      agentType: "antigravity",
      displayName: "Antigravity",
      kind: "terminal",
      workingDirectoryRequired: true,
      installed: true,
      shortcut: "A",
      order: 6,
      brandColor: "#8b5cf6",
    },
    {
      agentType: "gemini",
      displayName: "Gemini",
      kind: "terminal",
      workingDirectoryRequired: true,
      installed: false, // NOT installed
      shortcut: "M",
      order: 7,
      brandColor: "#4285f4",
    },
  ];

  test("derives only AVAILABLE (installed) CLI items + Terminal + Note", () => {
    const list = buildCreatableNodeList(sampleManifest);
    const ids = list.map((item) => item.id);
    expect(ids).toEqual([
      "claude-code",
      "pi",
      "bash",
      "antigravity",
      "note",
    ]);
  });

  test("unavailable adapters (Codex, ChatGPT, Gemini) do not appear in creatable list", () => {
    const list = buildCreatableNodeList(sampleManifest);
    expect(list.some((item) => item.id === "gemini")).toBe(false);
    expect(list.some((item) => item.id === "codex")).toBe(false);
    expect(list.some((item) => item.id === "codex-chatgpt")).toBe(false);
  });

  test("unavailable adapters do NOT reserve keyboard shortcuts", () => {
    const manifestWithCollidingUnavailable: AdapterManifestSummary[] = [
      {
        agentType: "gemini",
        displayName: "Gemini",
        kind: "terminal",
        workingDirectoryRequired: true,
        installed: false, // unavailable
        shortcut: "G",
      },
      {
        agentType: "custom-grid-bot",
        displayName: "Grid Bot",
        kind: "terminal",
        workingDirectoryRequired: true,
        installed: true,
        shortcut: "G", // Requests G
      },
    ];

    const list = buildCreatableNodeList(manifestWithCollidingUnavailable);
    const gridBot = list.find((i) => i.id === "custom-grid-bot");
    expect(gridBot?.shortcut).toBe("G"); // Free to take 'G' because Gemini is unavailable
  });

  test("Antigravity appears automatically when installed in manifest without special-casing", () => {
    const list = buildCreatableNodeList(sampleManifest);
    const antigravity = list.find((item) => item.id === "antigravity");
    expect(antigravity).toBeDefined();
    expect(antigravity?.name).toBe("Antigravity");
    expect(antigravity?.shortcut).toBe("A");
    expect(antigravity?.agentType).toBe("antigravity");
    expect(antigravity?.kind).toBe("agent");
  });

  test("Terminal and Note always appear even when other adapters are missing", () => {
    const emptyManifest: AdapterManifestSummary[] = [];
    const list = buildCreatableNodeList(emptyManifest);
    expect(list.map((i) => i.id)).toEqual(["note"]);

    const manifestWithBashOnly: AdapterManifestSummary[] = [
      {
        agentType: "bash",
        displayName: "Terminal",
        kind: "terminal",
        workingDirectoryRequired: true,
        installed: true,
        shortcut: "T",
        order: 4,
      },
    ];
    const listWithBash = buildCreatableNodeList(manifestWithBashOnly);
    expect(listWithBash.map((i) => i.id)).toEqual(["bash", "note"]);
  });

  test("Compare node does NOT appear in creatable list", () => {
    const list = buildCreatableNodeList(sampleManifest);
    expect(list.some((item) => item.id === "compare" || item.kind === "compare")).toBe(false);
  });

  test("Generic 'Agent' category does NOT appear in creatable list", () => {
    const list = buildCreatableNodeList(sampleManifest);
    expect(list.some((item) => item.id === "agent")).toBe(false);
  });

  test("Unknown future adapter renders automatically when installed using fallback presentation and fallback color", () => {
    const manifestWithFutureAgent: AdapterManifestSummary[] = [
      ...sampleManifest,
      {
        agentType: "future-custom-bot",
        displayName: "Future Custom Bot",
        kind: "terminal",
        workingDirectoryRequired: true,
        installed: true,
      },
    ];

    const list = buildCreatableNodeList(manifestWithFutureAgent);
    const futureItem = list.find((item) => item.id === "future-custom-bot");
    expect(futureItem).toBeDefined();
    expect(futureItem?.name).toBe("Future Custom Bot");
    expect(futureItem?.kind).toBe("agent");
    expect(futureItem?.brandColor).toBe(DEFAULT_OMNI_ACCENT_COLOR);
  });

  describe("Agent Brand Colors Resolution", () => {
    test("resolves native brand colors for configured adapters", () => {
      const list = buildCreatableNodeList(sampleManifest);
      const colorMap = Object.fromEntries(list.map((i) => [i.id, i.brandColor]));
      expect(colorMap["claude-code"]).toBe("#d97757");
      expect(colorMap["antigravity"]).toBe("#8b5cf6");
      expect(colorMap["bash"]).toBe("#38bdf8");
      expect(colorMap["note"]).toBe("#a78bfa");
    });

    test("respects dynamic brandColor override in manifest", () => {
      const customManifest: AdapterManifestSummary[] = [
        {
          agentType: "custom-agent",
          displayName: "Custom Agent",
          kind: "terminal",
          workingDirectoryRequired: true,
          installed: true,
          brandColor: "#ec4899",
        },
      ];
      const list = buildCreatableNodeList(customManifest);
      expect(list[0].brandColor).toBe("#ec4899");
    });

    test("getAgentAccentColor falls back safely to DEFAULT_OMNI_ACCENT_COLOR", () => {
      expect(getAgentAccentColor("unknown-agent-type")).toBe(DEFAULT_OMNI_ACCENT_COLOR);
      expect(getAgentAccentColor("unknown-agent-type", "#ff0055")).toBe("#ff0055");
    });
  });

  describe("Dynamic Keyboard Shortcuts & Collision Resolution", () => {
    test("respects explicit adapter shortcut metadata", () => {
      const list = buildCreatableNodeList(sampleManifest);
      const map = Object.fromEntries(list.map((i) => [i.id, i.shortcut]));
      expect(map["claude-code"]).toBe("C");
      expect(map["pi"]).toBe("P");
      expect(map["bash"]).toBe("T");
      expect(map["antigravity"]).toBe("A");
      expect(map["note"]).toBe("N");
    });

    test("resolves shortcut collisions deterministically so no duplicate keys exist", () => {
      const collidingItems: RawNodeItemInput[] = [
        {
          id: "agent-1",
          name: "Alpha Bot",
          kind: "agent",
          agentType: "agent-1",
          adapterKind: "terminal",
          workingDirectoryRequired: true,
          shortcut: "A",
        },
        {
          id: "agent-2",
          name: "Apex Agent",
          kind: "agent",
          agentType: "agent-2",
          adapterKind: "terminal",
          workingDirectoryRequired: true,
          shortcut: "A", // Collides with agent-1
        },
        {
          id: "agent-3",
          name: "Apollo",
          kind: "agent",
          agentType: "agent-3",
          adapterKind: "terminal",
          workingDirectoryRequired: true,
        },
      ];

      const resolved = resolveNodeShortcuts(collidingItems);
      const shortcuts = resolved.map((r) => r.shortcut);
      const uniqueShortcuts = new Set(shortcuts);

      // Must all be unique
      expect(uniqueShortcuts.size).toBe(resolved.length);
      expect(resolved[0].shortcut).toBe("A");
      expect(resolved[1].shortcut).toBe("P"); // 'P' from Apex
      expect(resolved[2].shortcut).toBe("O"); // 'O' from Apollo
    });

    test("pickAvailableShortcut falls back through words, characters, and alphabetical letters", () => {
      const used = new Set(["A", "B", "C"]);
      expect(pickAvailableShortcut("Beta Car", used)).toBe("E"); // 'E' from Beta
      expect(pickAvailableShortcut("XYZ", new Set(["X", "Y", "Z"]))).toBe("A"); // First free alphabetical (A)
    });

    test("matchNodeShortcut matches single characters case-insensitively", () => {
      const list = buildCreatableNodeList(sampleManifest);
      expect(matchNodeShortcut("c", list)?.id).toBe("claude-code");
      expect(matchNodeShortcut("C", list)?.id).toBe("claude-code");
      expect(matchNodeShortcut("a", list)?.id).toBe("antigravity");
      expect(matchNodeShortcut("A", list)?.id).toBe("antigravity");
      expect(matchNodeShortcut("n", list)?.id).toBe("note");
      expect(matchNodeShortcut("N", list)?.id).toBe("note");
    });

    test("matchNodeShortcut returns undefined for non-matching or multi-character keys", () => {
      const list = buildCreatableNodeList(sampleManifest);
      expect(matchNodeShortcut("z", list)).toBeUndefined();
      expect(matchNodeShortcut("Enter", list)).toBeUndefined();
      expect(matchNodeShortcut("Escape", list)).toBeUndefined();
      expect(matchNodeShortcut("", list)).toBeUndefined();
    });
  });

  describe("Canvas Global Shortcuts (findNextNodeForShortcut)", () => {
    const creatableList: CreatableNodeItem[] = [
      {
        id: "claude-code",
        name: "Claude Code",
        shortcut: "C",
        kind: "agent",
        agentType: "claude-code",
        adapterKind: "terminal",
        workingDirectoryRequired: true,
        brandColor: "#d97757",
      },
      {
        id: "antigravity",
        name: "Antigravity",
        shortcut: "A",
        kind: "agent",
        agentType: "antigravity",
        adapterKind: "terminal",
        workingDirectoryRequired: true,
        brandColor: "#8b5cf6",
      },
      {
        id: "note",
        name: "Note",
        shortcut: "N",
        kind: "note",
        agentType: "note",
        adapterKind: "terminal",
        workingDirectoryRequired: false,
        brandColor: "#a78bfa",
      },
    ];

    test("finds existing node matching pressed shortcut key", () => {
      const nodes: TakoNode[] = [
        mockAgentNode("node-1", "Apollo", "claude-code"),
        mockAgentNode("node-2", "Athena", "antigravity"),
        mockNoteNode("node-3", "Scratchpad"),
      ];

      expect(findNextNodeForShortcut("c", nodes, creatableList, null)?.id).toBe("node-1");
      expect(findNextNodeForShortcut("a", nodes, creatableList, null)?.id).toBe("node-2");
      expect(findNextNodeForShortcut("n", nodes, creatableList, null)?.id).toBe("node-3");
    });

    test("returns undefined if no node on canvas matches shortcut (NEVER creates node)", () => {
      const nodes: TakoNode[] = [mockAgentNode("node-1", "Apollo", "claude-code")];
      expect(findNextNodeForShortcut("a", nodes, creatableList, null)).toBeUndefined();
      expect(findNextNodeForShortcut("z", nodes, creatableList, null)).toBeUndefined();
    });

    test("cycles deterministically through multiple matching nodes when key is pressed repeatedly", () => {
      const nodes: TakoNode[] = [
        mockAgentNode("claude-1", "Apollo", "claude-code"),
        mockAgentNode("claude-2", "Reviewer", "claude-code"),
        mockAgentNode("claude-3", "Coder", "claude-code"),
      ];

      // Initially no node selected -> first matching node
      const first = findNextNodeForShortcut("c", nodes, creatableList, null);
      expect(first?.id).toBe("claude-1");

      // claude-1 is selected -> cycles to claude-2
      const second = findNextNodeForShortcut("c", nodes, creatableList, "claude-1");
      expect(second?.id).toBe("claude-2");

      // claude-2 is selected -> cycles to claude-3
      const third = findNextNodeForShortcut("c", nodes, creatableList, "claude-2");
      expect(third?.id).toBe("claude-3");

      // claude-3 is selected -> wraps back to claude-1
      const fourth = findNextNodeForShortcut("c", nodes, creatableList, "claude-3");
      expect(fourth?.id).toBe("claude-1");
    });
  });

  test("randomName generates non-empty strings", () => {
    const name = randomName();
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });
});
