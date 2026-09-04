import { useEffect, useMemo, useState } from "react";
import { Briefcase, ChevronLeft, Folder, Loader2, StickyNote, X } from "lucide-react";
import { DEFAULT_OMNI_ACCENT_COLOR, getAgentAccentColor, getAgentIcon, isAgentNode, type TakoNode } from "./types";
import { listRoleDefinitions } from "../../shared/roles";
import type { AdapterKind, AdapterManifestSummary, NodeKind } from "../../shared/types";

export interface CreatableNodeItem {
  id: string;
  name: string;
  shortcut: string;
  kind: NodeKind;
  agentType: string;
  adapterKind: AdapterKind;
  workingDirectoryRequired: boolean;
  brandColor: string;
  roleId?: string | null;
}

export interface RawNodeItemInput {
  id: string;
  name: string;
  kind: NodeKind;
  agentType: string;
  adapterKind: AdapterKind;
  workingDirectoryRequired: boolean;
  shortcut?: string;
  order?: number;
  brandColor?: string;
  roleId?: string | null;
}

/**
 * Prepares the list of tools to show when the user opens the Add palette (+), showing only what is actually installed on their computer plus Note.
 *
 * @example
 * Input:
 *   buildCreatableNodeList([
 *     { agentType: "claude-code", displayName: "Claude Code", kind: "terminal", workingDirectoryRequired: true, installed: true, shortcut: "C", order: 1 },
 *     { agentType: "gemini", displayName: "Gemini", kind: "terminal", workingDirectoryRequired: true, installed: false }
 *   ])
 * Output:
 *   [
 *     { id: "claude-code", name: "Claude Code", shortcut: "C", kind: "agent", ... },
 *     { id: "note", name: "Note", shortcut: "N", kind: "note", ... }
 *   ]
 */
export function buildCreatableNodeList(manifest: AdapterManifestSummary[]): CreatableNodeItem[] {
  const availableManifest = manifest.filter((m) => m.installed || m.agentType === "bash");

  const adapterItems: RawNodeItemInput[] = availableManifest.map((m) => ({
    id: m.agentType,
    name: m.displayName,
    kind: "agent" as NodeKind,
    agentType: m.agentType,
    adapterKind: m.kind,
    workingDirectoryRequired: m.workingDirectoryRequired,
    shortcut: m.shortcut,
    order: m.order ?? 100,
    brandColor: getAgentAccentColor(m.agentType, m.brandColor),
  }));

  adapterItems.sort((a, b) => {
    const orderA = a.order ?? 100;
    const orderB = b.order ?? 100;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });

  const allRawItems: RawNodeItemInput[] = [
    ...adapterItems,
    {
      id: "note",
      name: "Note",
      kind: "note" as NodeKind,
      agentType: "note",
      adapterKind: "terminal",
      workingDirectoryRequired: false,
      shortcut: "N",
      order: 999,
      brandColor: DEFAULT_OMNI_ACCENT_COLOR,
    },
  ];

  return resolveNodeShortcuts(allRawItems);
}

/**
 * Gives each tool a unique single-letter keyboard shortcut so the user can quickly pick tools by pressing one key.
 *
 * @example
 * Input:
 *   resolveNodeShortcuts([
 *     { id: "claude", name: "Claude Code", shortcut: "C", ... },
 *     { id: "codex", name: "Codex", shortcut: "C", ... }
 *   ])
 * Output:
 *   [
 *     { id: "claude", name: "Claude Code", shortcut: "C", ... },
 *     { id: "codex", name: "Codex", shortcut: "O", ... }
 *   ]
 */
export function resolveNodeShortcuts(items: RawNodeItemInput[]): CreatableNodeItem[] {
  const usedShortcuts = new Set<string>();
  const result: CreatableNodeItem[] = [];

  for (const item of items) {
    const candidate = item.shortcut?.toUpperCase();
    if (candidate && /^[A-Z0-9]$/.test(candidate) && !usedShortcuts.has(candidate)) {
      usedShortcuts.add(candidate);
    }
  }

  const assigned = new Set<string>();
  for (const item of items) {
    let shortcut = item.shortcut?.toUpperCase();
    if (!shortcut || !/^[A-Z0-9]$/.test(shortcut) || assigned.has(shortcut)) {
      shortcut = pickAvailableShortcut(item.name, usedShortcuts);
    }
    usedShortcuts.add(shortcut);
    assigned.add(shortcut);

    result.push({
      id: item.id,
      name: item.name,
      shortcut,
      kind: item.kind,
      agentType: item.agentType,
      adapterKind: item.adapterKind,
      workingDirectoryRequired: item.workingDirectoryRequired,
      brandColor: item.brandColor ?? DEFAULT_OMNI_ACCENT_COLOR,
    });
  }

  return result;
}

/**
 * Finds a free letter for a tool's shortcut when its preferred letter is already used by another tool.
 *
 * @example
 * Input:
 *   pickAvailableShortcut("Claude Code", new Set(["C"]))
 * Output:
 *   "L"
 */
export function pickAvailableShortcut(name: string, used: Set<string>): string {
  const words = name.trim().split(/\s+/);

  for (const w of words) {
    const char = w.charAt(0).toUpperCase();
    if (/^[A-Z0-9]$/.test(char) && !used.has(char)) {
      return char;
    }
  }

  for (let i = 0; i < name.length; i++) {
    const char = name.charAt(i).toUpperCase();
    if (/^[A-Z0-9]$/.test(char) && !used.has(char)) {
      return char;
    }
  }

  for (let code = 65; code <= 90; code++) {
    const char = String.fromCharCode(code);
    if (!used.has(char)) {
      return char;
    }
  }

  return "?";
}

/**
 * Checks if a key pressed by the user matches any tool in the Add palette.
 *
 * @example
 * Input:
 *   matchNodeShortcut("c", [{ id: "claude-code", shortcut: "C", ... }])
 * Output:
 *   { id: "claude-code", shortcut: "C", ... }
 */
export function matchNodeShortcut(key: string, items: CreatableNodeItem[]): CreatableNodeItem | undefined {
  if (!key || key.length !== 1) return undefined;
  const upper = key.toUpperCase();
  return items.find((item) => item.shortcut.toUpperCase() === upper);
}

/**
 * Finds and selects an existing node on the canvas when the user presses a shortcut key (like C or A) from the canvas, cycling if there are multiple.
 *
 * @example
 * Input:
 *   findNextNodeForShortcut("c", [apolloClaudeNode], creatableList, null)
 * Output:
 *   apolloClaudeNode (selects and brings Apollo into view)
 */
export function findNextNodeForShortcut(
  key: string,
  nodes: TakoNode[],
  creatableList: CreatableNodeItem[],
  selectedNodeId: string | null,
): TakoNode | undefined {
  if (!key || key.length !== 1) return undefined;
  const match = matchNodeShortcut(key, creatableList);
  if (!match) return undefined;

  const matchingNodes = nodes.filter((n) => {
    if (match.kind === "note") {
      return n.type === "noteNode";
    }
    if (isAgentNode(n)) {
      return n.data.agentType === match.agentType;
    }
    return false;
  });

  if (matchingNodes.length === 0) return undefined;
  if (matchingNodes.length === 1) return matchingNodes[0];

  const currentIndex = matchingNodes.findIndex((n) => n.id === selectedNodeId);
  if (currentIndex >= 0) {
    const nextIndex = (currentIndex + 1) % matchingNodes.length;
    return matchingNodes[nextIndex];
  }

  const sorted = [...matchingNodes].sort((a, b) => {
    const timeA = isAgentNode(a) ? (a.data.lastActivityAt ?? 0) : 0;
    const timeB = isAgentNode(b) ? (b.data.lastActivityAt ?? 0) : 0;
    return timeB - timeA;
  });

  return sorted[0];
}

interface AddNodePopoverProps {
  onCreate: (input: {
    name: string;
    kind: NodeKind;
    agentType: string;
    adapterKind: AdapterKind;
    workingDirectory: string | null;
    roleId?: string | null;
    config?: Record<string, unknown>;
  }) => void;
  onClose: () => void;
}

type Step = "list" | "config";

const RANDOM_NAMES = ["Apollo", "Hermes", "Orion", "Athena", "Phoenix", "Freyr", "Odin", "Griffin", "Loki", "Draco", "Juno", "Reviewer", "Scout", "Planner", "Tester"];

/**
 * Generates a friendly, recognizable name for a new agent so the user doesn't have to type one.
 *
 * @example
 * Input:
 *   randomName()
 * Output:
 *   "Apollo"
 */
export function randomName(): string {
  return RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
}

/**
 * Displays the Add Node palette when the user clicks + on the toolbar, letting them choose an agent or note.
 *
 * @example
 * Input:
 *   <AddNodePopover onCreate={handleCreate} onClose={handleClose} />
 * Output:
 *   Renders the floating 3-column icon grid.
 */
export function AddNodePopover({ onCreate, onClose }: AddNodePopoverProps) {
  const [step, setStep] = useState<Step>("list");
  const [manifest, setManifest] = useState<AdapterManifestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<CreatableNodeItem | null>(null);
  const [agentName, setAgentName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.tako.adapters
      .list()
      .then((list) => {
        if (!cancelled) {
          setManifest(list);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : "Failed to load adapters");
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const items: CreatableNodeItem[] = useMemo(() => {
    return buildCreatableNodeList(manifest);
  }, [manifest]);

  const handleSelectItem = (item: CreatableNodeItem) => {
    if (item.kind === "note") {
      onCreate({
        name: randomName(),
        kind: "note",
        agentType: "note",
        adapterKind: "terminal",
        workingDirectory: null,
      });
      onClose();
      return;
    }

    setSelectedAgent(item);
    setAgentName(item.roleId ? item.name : randomName());
    setWorkingDirectory(null);
    setError(null);
    setStep("config");
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest(".command-bar") ||
          target.closest(".workflow-switcher__dialog") ||
          target.closest(".monaco-editor"));

      if (e.key === "Escape") {
        if (step === "config") {
          setStep("list");
          setSelectedAgent(null);
        } else {
          onClose();
        }
        return;
      }

      if (step === "list" && !isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const match = matchNodeShortcut(e.key, items);
        if (match) {
          e.preventDefault();
          handleSelectItem(match);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, items, onClose]);

  const handlePickDirectory = async () => {
    const picked = await window.tako.dialogs.pickDirectory();
    if (picked) {
      setWorkingDirectory(picked);
      setError(null);
    }
  };

  const handleCreateAgent = () => {
    if (!selectedAgent) return;
    const name = agentName.trim();
    if (!name) {
      setError("Enter an agent name.");
      return;
    }
    if (selectedAgent.workingDirectoryRequired && selectedAgent.agentType !== "bash" && !workingDirectory) {
      setError("Choose a workspace directory for this agent.");
      return;
    }
    onCreate({
      name,
      kind: "agent",
      agentType: selectedAgent.agentType,
      adapterKind: selectedAgent.adapterKind,
      workingDirectory,
      roleId: selectedAgent.roleId ?? null,
      config: selectedAgent.roleId ? { roleId: selectedAgent.roleId } : undefined,
    });
    onClose();
  };

  return (
    <div className="add-node-popover omni-panel" onClick={(e) => e.stopPropagation()}>
      {step === "list" ? (
        <>
          <div className="omni-panel-header">
            <span>Add</span>
            <button type="button" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>

          {isLoading ? (
            <div className="add-node-popover__loading">
              <Loader2 size={16} className="command-bar__spinner" />
              <span>Loading agents…</span>
            </div>
          ) : (
            <>
              {fetchError && <p className="omni-field-error">{fetchError}</p>}
              <div className="add-node-popover__grid" role="grid" aria-label="Available node types">
                {items.map((item) => {
                  const Icon = item.kind === "note" ? StickyNote : item.roleId ? Briefcase : getAgentIcon(item.agentType);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="add-node-popover__tile"
                      style={{ "--tile-accent": item.brandColor } as React.CSSProperties}
                      aria-label={item.name}
                      data-tooltip={item.name}
                      onClick={() => handleSelectItem(item)}
                    >
                      <span className="add-node-popover__tile-shortcut">{item.shortcut}</span>
                      <span className="add-node-popover__tile-icon">
                        <Icon size={22} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : (
        selectedAgent && (
          <>
            <div className="omni-panel-header">
              <button
                type="button"
                onClick={() => {
                  setStep("list");
                  setSelectedAgent(null);
                }}
                aria-label="Back"
              >
                <ChevronLeft size={14} />
              </button>
              <span>{selectedAgent.name}</span>
              <button type="button" onClick={onClose} aria-label="Close">
                <X size={14} />
              </button>
            </div>

            <div className="add-node-popover__form">
              <div className="add-node-popover__field">
                <label htmlFor="agent-name-input">Name</label>
                <input
                  id="agent-name-input"
                  autoFocus
                  className="omni-input"
                  value={agentName}
                  onChange={(e) => {
                    setAgentName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateAgent()}
                  placeholder="e.g. Apollo"
                />
              </div>

              {selectedAgent.workingDirectoryRequired && selectedAgent.agentType !== "bash" && (
                <div className="add-node-popover__field">
                  <label>Workspace</label>
                  <div className="add-node-popover__folder-row">
                    <div
                      className="add-node-popover__folder-display"
                      title={workingDirectory ?? "No folder chosen"}
                    >
                      <Folder size={14} />
                      <span>{workingDirectory ? workingDirectory.split("/").pop() || workingDirectory : "Choose folder…"}</span>
                    </div>
                    <button
                      type="button"
                      className="omni-btn-secondary add-node-popover__browse-btn"
                      onClick={() => void handlePickDirectory()}
                    >
                      Browse
                    </button>
                  </div>
                </div>
              )}

              {error && <p className="omni-field-error">{error}</p>}

              <div className="add-node-popover__actions">
                <button
                  type="button"
                  className="omni-btn-primary"
                  onClick={handleCreateAgent}
                >
                  Create
                </button>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
