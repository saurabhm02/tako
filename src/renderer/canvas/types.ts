import type { Node, Edge } from "@xyflow/react";
import type { ReactNode } from "react";
import { Bot, Moon, Pi as PiIcon, SquareTerminal } from "lucide-react";
import { edgeVisualProps } from "./edgeStyle";
import { AnthropicIcon, AntigravityIcon, AwsIcon, GeminiIcon, OpenAIIcon } from "./brandIcons";
import type {
  AdapterError,
  AdapterKind,
  CodeChangeSummaryRow,
  ConnectionRecord,
  HandoffSummary,
  NodeRecord,
  NodeRuntimeState,
  NodeStatus,
  RuntimeHandoff,
} from "../../shared/types";

export interface AgentNodeData extends Record<string, unknown> {
  name: string;
  agentType: string;
  adapterKind: AdapterKind;
  workingDirectory: string | null;
  config: Record<string, unknown>;
  status: NodeStatus;
  error: AdapterError | null;
  lastActivityAt: number | null;
  lastCodeChange: CodeChangeSummaryRow | null;
}

export interface NoteNodeData extends Record<string, unknown> {
  name: string;
  config: Record<string, unknown>;
}

export interface CompareNodeData extends Record<string, unknown> {
  name: string;
  config: Record<string, unknown>;
}

export type TakoNode = Node<AgentNodeData> | Node<NoteNodeData> | Node<CompareNodeData>;

export const DEFAULT_AGENT_NODE_WIDTH = 560;
export const DEFAULT_AGENT_NODE_HEIGHT = 420;

/**
 * Checks if a canvas item is an interactive AI agent (rather than a note or comparison card).
 *
 * @example
 * Input:
 *   isAgentNode({ id: "1", type: "agentNode", ... })
 * Output:
 *   true
 */
export function isAgentNode(node: TakoNode): node is Node<AgentNodeData> {
  return node.type === "agentNode";
}

export interface ConnectionEdgeData extends Record<string, unknown> {
  autoApprove: boolean;
}

export type TakoEdge = Edge<ConnectionEdgeData>;

export const AGENT_TYPES = [
  "claude-code",
  "codex",
  "codex-chatgpt",
  "gemini",
  "pi",
  "kiro",
  "kimi",
  "bash",
  "antigravity",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "codex-chatgpt": "ChatGPT",
  gemini: "Gemini",
  pi: "Pi",
  kiro: "Kiro",
  kimi: "Kimi",
  bash: "Terminal",
  antigravity: "Antigravity",
};

export type AgentIconComponent = (props: { size?: number }) => ReactNode;

export const AGENT_ICONS: Record<string, AgentIconComponent> = {
  "claude-code": AnthropicIcon,
  codex: OpenAIIcon,
  "codex-chatgpt": OpenAIIcon,
  gemini: GeminiIcon,
  pi: PiIcon,
  kiro: AwsIcon,
  kimi: Moon,
  bash: SquareTerminal,
  antigravity: AntigravityIcon,
};

/**
 * Returns the brand logo component for an agent so it displays on its node tile and header card.
 *
 * @example
 * Input:
 *   getAgentIcon("antigravity")
 * Output:
 *   AntigravityIcon (renders the orbit mark)
 */
export function getAgentIcon(agentType: string): AgentIconComponent {
  return AGENT_ICONS[agentType] ?? Bot;
}

export const AGENT_ACCENT_COLORS: Record<string, string> = {
  "claude-code": "#d97757",
  codex: "#10a37f",
  "codex-chatgpt": "#10a37f",
  gemini: "#4285f4",
  pi: "#a78bfa",
  kiro: "#f472b6",
  kimi: "#38bdf8",
  bash: "#38bdf8",
  antigravity: "#8b5cf6",
};

export const DEFAULT_OMNI_ACCENT_COLOR = "#a78bfa";

/**
 * Returns the brand color for an agent so its header badge and hover effects match its brand.
 *
 * @example
 * Input:
 *   getAgentAccentColor("claude-code")
 * Output:
 *   "#d97757"
 */
export function getAgentAccentColor(agentType: string, brandColorOverride?: string | null): string {
  if (brandColorOverride && brandColorOverride.trim().length > 0) {
    return brandColorOverride;
  }
  return AGENT_ACCENT_COLORS[agentType] ?? DEFAULT_OMNI_ACCENT_COLOR;
}

/**
 * Returns the user's custom name for a node, or falls back to the default agent name if no custom name was entered.
 *
 * @example
 * Input:
 *   nodeDisplayName("", "claude-code")
 * Output:
 *   "Claude Code"
 */
export function nodeDisplayName(name: string, agentType: string): string {
  return name.trim().length > 0 ? name : (AGENT_DISPLAY_NAMES[agentType] ?? agentType);
}

/**
 * Converts technical status codes like "not_started" or "running" into clean everyday words like "not started" or "running".
 *
 * @example
 * Input:
 *   formatStatus("not_started")
 * Output:
 *   "not started"
 */
export function formatStatus(status: NodeStatus | NodeRuntimeState | string): string {
  return status.replace(/_/g, " ");
}

const ADAPTER_ERROR_LABELS: Record<AdapterError["kind"], string> = {
  auth: "Sign-in needed",
  network: "Network problem",
  rate_limit: "Rate limited",
  crash: "Agent crashed",
  unknown: "Something went wrong",
  session_recovered: "Session recovered",
};

/**
 * Formats internal errors into a clear, helpful message explaining what happened and how to fix it.
 *
 * @example
 * Input:
 *   formatAdapterError({ kind: "auth", message: "API key missing", recoverable: false })
 * Output:
 *   "Sign-in needed — API key missing"
 */
export function formatAdapterError(error: AdapterError): string {
  return `${ADAPTER_ERROR_LABELS[error.kind]} — ${error.message}`;
}

/**
 * Counts how many messages from this agent are currently waiting for user review and approval.
 *
 * @example
 * Input:
 *   pendingHandoffCountForNode([{ fromNodeId: "node-1", toNodeId: "node-2", ... }], "node-1")
 * Output:
 *   1
 */
export function pendingHandoffCountForNode(pending: Array<HandoffSummary | RuntimeHandoff>, nodeId: string): number {
  return pending.filter((h) => h.fromNodeId === nodeId && (!("status" in h) || h.status === "created" || (h as any).status === "pending")).length;
}

/**
 * Checks if a handoff message is waiting to travel across a connection line between two nodes.
 *
 * @example
 * Input:
 *   hasPendingHandoffForEdge([{ fromNodeId: "a", toNodeId: "b", ... }], "a", "b")
 * Output:
 *   true
 */
export function hasPendingHandoffForEdge(pending: Array<HandoffSummary | RuntimeHandoff>, source: string, target: string): boolean {
  return pending.some((h) => h.fromNodeId === source && h.toNodeId === target && (!("status" in h) || h.status === "created" || (h as any).status === "pending"));
}

/**
 * Clears waiting handoff cards from the sidebar when the user deletes a node from the canvas.
 *
 * @example
 * Input:
 *   removePendingHandoffsForNode([{ fromNodeId: "a", toNodeId: "b", ... }], "a")
 * Output:
 *   []
 */
export function removePendingHandoffsForNode<T extends { fromNodeId: string; toNodeId: string }>(pending: T[], nodeId: string): T[] {
  return pending.filter((h) => h.fromNodeId !== nodeId && h.toNodeId !== nodeId);
}

/**
 * Converts a saved database row into a visual card ready to display on the canvas.
 *
 * @example
 * Input:
 *   nodeRecordToTakoNode({ id: "1", name: "Apollo", kind: "agent", agentType: "claude-code", adapterKind: "terminal", workingDirectory: "/tmp", config: {}, position: { x: 0, y: 0 } })
 * Output:
 *   { id: "1", type: "agentNode", position: { x: 0, y: 0 }, data: { name: "Apollo", agentType: "claude-code", status: "not_started", ... } }
 */
export function nodeRecordToTakoNode(record: NodeRecord): TakoNode {
  if (record.kind === "note") {
    return {
      id: record.id,
      type: "noteNode",
      position: record.position,
      data: { name: record.name, config: record.config },
    };
  }
  if (record.kind === "compare") {
    return {
      id: record.id,
      type: "compareNode",
      position: record.position,
      data: { name: record.name, config: record.config },
    };
  }
  const savedWidth = record.config.width;
  const savedHeight = record.config.height;
  return {
    id: record.id,
    type: "agentNode",
    position: record.position,
    width: typeof savedWidth === "number" ? savedWidth : DEFAULT_AGENT_NODE_WIDTH,
    height: typeof savedHeight === "number" ? savedHeight : DEFAULT_AGENT_NODE_HEIGHT,
    data: {
      name: record.name,
      agentType: record.agentType,
      adapterKind: record.adapterKind,
      workingDirectory: record.workingDirectory,
      config: record.config,
      status: "not_started",
      error: null,
      lastActivityAt: null,
      lastCodeChange: null,
    },
  };
}

/**
 * Converts a visual canvas card into a database row to save the user's workflow to disk.
 *
 * @example
 * Input:
 *   takoNodeToNodeRecord(agentNode)
 * Output:
 *   { id: "1", name: "Apollo", kind: "agent", agentType: "claude-code", adapterKind: "terminal", workingDirectory: "/tmp", config: { width: 560, height: 420 }, position: { x: 0, y: 0 } }
 */
export function takoNodeToNodeRecord(node: TakoNode): NodeRecord {
  if (node.type === "noteNode") {
    const data = node.data as NoteNodeData;
    return {
      id: node.id,
      name: data.name,
      kind: "note",
      agentType: "note",
      adapterKind: "terminal",
      workingDirectory: null,
      config: data.config,
      position: node.position,
    };
  }
  if (node.type === "compareNode") {
    const data = node.data as CompareNodeData;
    return {
      id: node.id,
      name: data.name,
      kind: "compare",
      agentType: "compare",
      adapterKind: "terminal",
      workingDirectory: null,
      config: data.config,
      position: node.position,
    };
  }
  const data = node.data as AgentNodeData;
  return {
    id: node.id,
    name: data.name,
    kind: "agent",
    agentType: data.agentType,
    adapterKind: data.adapterKind,
    workingDirectory: data.workingDirectory,
    config: {
      ...data.config,
      width: node.width ?? data.config.width ?? DEFAULT_AGENT_NODE_WIDTH,
      height: node.height ?? data.config.height ?? DEFAULT_AGENT_NODE_HEIGHT,
    },
    position: node.position,
  };
}

/**
 * Converts a saved connection row from the database into a visual line connecting two nodes on the canvas.
 *
 * @example
 * Input:
 *   connectionRecordToTakoEdge({ id: "e1", fromNodeId: "n1", toNodeId: "n2", autoApprove: false })
 * Output:
 *   { id: "e1", source: "n1", target: "n2", data: { autoApprove: false } }
 */
export function connectionRecordToTakoEdge(record: ConnectionRecord): TakoEdge {
  return {
    id: record.id,
    source: record.fromNodeId,
    target: record.toNodeId,
    data: { autoApprove: record.autoApprove },
    ...edgeVisualProps(record.autoApprove),
  };
}

/**
 * Converts a visual connection line between two nodes into a database row so it can be saved to disk.
 *
 * @example
 * Input:
 *   takoEdgeToConnectionRecord({ id: "e1", source: "n1", target: "n2", data: { autoApprove: true } })
 * Output:
 *   { id: "e1", fromNodeId: "n1", toNodeId: "n2", autoApprove: true }
 */
export function takoEdgeToConnectionRecord(edge: TakoEdge): ConnectionRecord {
  return {
    id: edge.id,
    fromNodeId: edge.source,
    toNodeId: edge.target,
    autoApprove: Boolean(edge.data?.autoApprove),
  };
}

/**
 * Clones all nodes and connections with brand new IDs when the user duplicates or "Saves As" a workflow.
 *
 * @example
 * Input:
 *   duplicateSnapshotWithFreshIds([{ id: "old-1", ... }], [{ id: "edge-1", fromNodeId: "old-1", toNodeId: "old-2" }])
 * Output:
 *   { nodes: [{ id: "new-uuid-1", ... }], connections: [{ id: "new-edge-uuid", fromNodeId: "new-uuid-1", toNodeId: "new-uuid-2" }] }
 */
export function duplicateSnapshotWithFreshIds(
  nodes: NodeRecord[],
  connections: ConnectionRecord[],
): { nodes: NodeRecord[]; connections: ConnectionRecord[] } {
  const idMap = new Map(nodes.map((n) => [n.id, crypto.randomUUID()]));
  return {
    nodes: nodes.map((n) => ({ ...n, id: idMap.get(n.id)! })),
    connections: connections.map((c) => ({
      ...c,
      id: crypto.randomUUID(),
      fromNodeId: idMap.get(c.fromNodeId)!,
      toNodeId: idMap.get(c.toNodeId)!,
    })),
  };
}

/**
 * Turns an object into clean JSON with sorted keys so Omni knows when a workflow has real unsaved changes.
 *
 * @example
 * Input:
 *   stableStringify({ b: 1, a: 2 })
 * Output:
 *   '{"a":2,"b":1}'
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Creates a saved snapshot string of the workflow so Omni knows if the user made changes that need saving.
 *
 * @example
 * Input:
 *   serializeWorkflowContent([nodeRecord], [connectionRecord])
 * Output:
 *   '{"connections":[...],"nodes":[...]}'
 */
export function serializeWorkflowContent(nodes: NodeRecord[], connections: ConnectionRecord[]): string {
  return stableStringify({ nodes, connections });
}
