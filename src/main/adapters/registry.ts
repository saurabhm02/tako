import type { Adapter } from "./Adapter";
import type { AdapterKind } from "../../shared/types";

export interface AdapterFactoryInput {
  nodeId: string;
  workingDirectory: string | null;
  config: Record<string, unknown>;
  resumeSessionRef: string | null;
}

export interface AdapterManifestEntry {
  agentType: string;
  displayName: string;
  kind: AdapterKind;
  workingDirectoryRequired: boolean;
  factory: (input: AdapterFactoryInput) => Adapter;
  checkCommand?: string;
  shortcut?: string;
  order?: number;
  brandColor?: string;
}

const registry = new Map<string, AdapterManifestEntry>();

/**
 * Saves an agent's setup details in Omni so the app knows how to create and run it.
 *
 * @example
 * Input:
 *   registerAdapter({ agentType: "claude-code", displayName: "Claude Code", kind: "terminal", workingDirectoryRequired: true, factory: createClaudeCodeAdapter })
 * Output:
 *   Omni now knows how to run Claude Code when the user adds it.
 */
export function registerAdapter(entry: AdapterManifestEntry): void {
  registry.set(entry.agentType, entry);
}

/**
 * Looks up the setup information for a specific agent type.
 *
 * @example
 * Input:
 *   getAdapterManifest("claude-code")
 * Output:
 *   { agentType: "claude-code", displayName: "Claude Code", kind: "terminal", ... }
 */
export function getAdapterManifest(
  agentType: string,
): AdapterManifestEntry | undefined {
  return registry.get(agentType);
}

/**
 * Returns all the agents Omni supports so the UI can display them to the user.
 *
 * @example
 * Input:
 *   listAdapterManifest()
 * Output:
 *   [ { agentType: "claude-code", displayName: "Claude Code" }, { agentType: "antigravity", displayName: "Antigravity" } ]
 */
export function listAdapterManifest(): AdapterManifestEntry[] {
  return [...registry.values()];
}

/**
 * Creates and starts a real agent adapter when the user adds an agent node to the canvas.
 *
 * @example
 * Input:
 *   createAdapter("claude-code", { nodeId: "node-1", workingDirectory: "/Users/dev/project", config: {}, resumeSessionRef: null })
 * Output:
 *   A running terminal adapter connected to Claude Code in "/Users/dev/project".
 */
export function createAdapter(
  agentType: string,
  input: AdapterFactoryInput,
): Adapter {
  const entry = getAdapterManifest(agentType);
  if (!entry) {
    throw new Error(`No adapter registered for agent type "${agentType}"`);
  }
  if (entry.workingDirectoryRequired && !input.workingDirectory) {
    throw new Error(`Agent "${agentType}" requires a working directory`);
  }
  return entry.factory(input);
}
