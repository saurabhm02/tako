import { isAgentNode, type TakoEdge, type TakoNode } from "./types";
import type { AdapterKind, AdapterManifestSummary, AgentProfile, CanvasAction, CanvasCommandContext, CanvasQuery } from "../../shared/types";
import { statusBucket, STATUS_BUCKET_LABEL, type StatusBucket } from "./overviewFilters";

export type { CanvasAction };

const SELECTED_NODE_REF = "$selected";
const PRONOUNS = new Set(["it", "this", "that", "this node", "that node", "this agent", "that agent", "selected node", "the selected node", "the selected agent"]);

/**
 * Packages what is currently on the canvas (agent names, statuses, connections) so the AI assistant understands the user's workspace without seeing any private files or secrets.
 *
 * @example
 * Input:
 *   buildCommandContext([node1], [edge1], adapters, {}, "node1", "My Workflow")
 * Output:
 *   {
 *     nodes: [{ name: "Apollo", agentType: "claude-code", status: "idle", profile: null }],
 *     edges: [{ from: "Apollo", to: "Reviewer" }],
 *     installedAgents: ["claude-code"],
 *     selectedNodeName: "Apollo",
 *     workflowName: "My Workflow"
 *   }
 */
export function buildCommandContext(
  nodes: TakoNode[],
  edges: TakoEdge[],
  adapters: AdapterManifestSummary[],
  profilesByAgentType: Record<string, AgentProfile[]>,
  selectedNodeId: string | null,
  workflowName: string,
): CanvasCommandContext {
  const selected = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
  return {
    nodes: nodes.filter(isAgentNode).map((n) => ({
      name: n.data.name,
      agentType: n.data.agentType,
      status: n.data.status,
      profile: (profilesByAgentType[n.data.agentType] ?? []).find((p) => p.id === n.data.config.profileId)?.label ?? null,
    })),
    edges: edges.map((e) => {
      const source = nodes.find((n) => n.id === e.source);
      const target = nodes.find((n) => n.id === e.target);
      return { from: source && isAgentNode(source) ? source.data.name : "", to: target && isAgentNode(target) ? target.data.name : "" };
    }),
    installedAgents: [...new Set(adapters.map((a) => a.agentType))],
    selectedNodeName: selected && isAgentNode(selected) ? selected.data.name : null,
    workflowName,
  };
}

/**
 * Converts everyday words like "it", "this node", or "that agent" into a reference to whatever node the user currently has selected.
 *
 * @example
 * Input:
 *   normalizeRef("this node")
 * Output:
 *   "$selected"
 */
function normalizeRef(ref: string): string {
  return PRONOUNS.has(ref.trim().toLowerCase()) ? SELECTED_NODE_REF : ref.trim();
}

export interface ParseSuccess {
  ok: true;
  actions: CanvasAction[];
}
export interface ParseFailure {
  ok: false;
  reason: string;
}
export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Strips conversational filler and quotes from names the user types or speaks, so "called 'Apollo'" becomes just "Apollo".
 *
 * @example
 * Input:
 *   cleanName("called 'Apollo'")
 * Output:
 *   "Apollo"
 */
function cleanName(raw?: string): string | undefined {
  if (!raw) return undefined;
  let trimmed = raw.trim().replace(/^["']|["']$/g, "").trim();
  trimmed = trimmed.replace(/[.]+$/, "").trim();
  trimmed = trimmed.replace(/^(?:(?:an?|the)\s+)?(?:agent\s+)?(?:called|named|name)\s+/i, "").trim();
  return trimmed || undefined;
}

const PATTERNS: Array<{ re: RegExp; build: (m: RegExpMatchArray) => CanvasAction }> = [
  {
    re: /^(?:add|create)\s+(?:(?:an?|the)\s+agent\s+(?:called|named)\s+)?(.+?)\s+(?:using|with|as)\s+(?:an?\s+)?(.+?)(?:\s+agent)?$/i,
    build: (m) => ({ type: "addNode", agentType: m[2].trim(), name: cleanName(m[1]) }),
  },
  {
    re: /^make\s+(.+?)\s+(?:an?|into\s+an?)\s+(.+?)(?:\s+agent)?$/i,
    build: (m) => ({ type: "addNode", agentType: m[2].trim(), name: cleanName(m[1]) }),
  },
  {
    re: /^(?:(?:i\s+want\s+(?:to\s+(?:add|create)\s+|an?\s+)?|please\s+(?:add|create)\s+)|(?:add|create|make)\s+(?:an?\s+)?)(?!all\b)(claude\s+code|claude|pi|codex|terminal|bash|\S+)(?:\s+agent)?(?:\s+(?:called|named|name))?(?:\s+(.+))?$/i,
    build: (m) => ({ type: "addNode", agentType: m[1].trim(), name: cleanName(m[2]) }),
  },
  {
    re: /^rename\s+(.+?)\s+to\s+(.+)$/i,
    build: (m) => ({ type: "renameNode", nodeRef: normalizeRef(m[1]), newName: cleanName(m[2]) ?? m[2].trim() }),
  },
  {
    re: /^switch\s+(.+?)\s+to\s+(.+)$/i,
    build: (m) => ({ type: "setProfile", nodeRef: normalizeRef(m[1]), profileRef: m[2].trim() }),
  },
  {
    re: /^disconnect\s+(.+?)\s+from\s+(.+)$/i,
    build: (m) => ({ type: "disconnect", from: normalizeRef(m[1]), to: normalizeRef(m[2]) }),
  },
  {
    re: /^connect\s+(.+?)\s+(?:to|with)\s+(.+)$/i,
    build: (m) => ({ type: "connect", from: normalizeRef(m[1]), to: normalizeRef(m[2]) }),
  },
  {
    re: /^(?:remove|delete)\s+(.+)$/i,
    build: (m) => ({ type: "removeNode", nodeRef: normalizeRef(m[1]) }),
  },
  {
    re: /^mark\s+(.+?)\s+(?:as\s+)?done$/i,
    build: (m) => ({ type: "markDone", nodeRef: normalizeRef(m[1]) }),
  },
  { re: /^(?:run|execute)(?:\s+(?:this\s+)?workflow)?$/i, build: () => ({ type: "runWorkflow" }) },
  { re: /^(?:stop|cancel)(?:\s+(?:this\s+)?workflow)?$/i, build: () => ({ type: "stopWorkflow" }) },
  {
    re: /^retry(?:\s+(.+))?$/i,
    build: (m) => ({ type: "retryNode", nodeRef: m[1] ? normalizeRef(m[1]) : undefined }),
  },
  { re: /^stop\s+all(?:\s+agents)?$/i, build: () => ({ type: "stopAll" }) },
  { re: /^clear\s+(?:all(?:\s+nodes)?|the\s+canvas)$/i, build: () => ({ type: "clearAll" }) },
  { re: /^(?:fit(?:\s+view)?|center(?:\s+canvas|\s+workflow)?|zoom\s+to\s+fit)$/i, build: () => ({ type: "fitView" }) },
  { re: /^(?:open\s+)?history$/i, build: () => ({ type: "openHistory" }) },
  { re: /^(?:open\s+)?activity(?:\s+timeline)?$/i, build: () => ({ type: "openActivity" }) },
  {
    re: /^stop\s+(?!all\b)(.+)$/i,
    build: (m) => ({ type: "stopNode", nodeRef: normalizeRef(m[1]) }),
  },
  {
    re: /^start\s+(.+)$/i,
    build: (m) => ({ type: "startNode", nodeRef: normalizeRef(m[1]) }),
  },
  {
    re: /^restart\s+(.+)$/i,
    build: (m) => ({ type: "restartNode", nodeRef: normalizeRef(m[1]) }),
  },
];

/**
 * Matches a single command phrase against standard natural language patterns (like "add", "connect", "stop").
 *
 * @example
 * Input:
 *   parseOne("Add a Claude agent called Apollo")
 * Output:
 *   { type: "addNode", agentType: "Claude", name: "Apollo" }
 */
function parseOne(segment: string): CanvasAction | null {
  for (const { re, build } of PATTERNS) {
    const m = segment.match(re);
    if (m) return build(m);
  }
  return null;
}

/**
 * Reads what the user typed or spoke in the command bar and turns it into concrete actions for the canvas.
 *
 * @example
 * Input:
 *   interpret("Create Claude Apollo and connect Apollo to Reviewer")
 * Output:
 *   {
 *     ok: true,
 *     actions: [
 *       { type: "addNode", agentType: "Claude", name: "Apollo" },
 *       { type: "connect", from: "Apollo", to: "Reviewer" }
 *     ]
 *   }
 */
export function interpret(text: string): ParseResult {
  const segments = text
    .split(/\s+and\s+|;/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return { ok: false, reason: "Type a command." };

  const actions: CanvasAction[] = [];
  for (const segment of segments) {
    const action = parseOne(segment);
    if (!action) return { ok: false, reason: `I don't understand "${segment}".` };
    actions.push(action);
  }
  return { ok: true, actions };
}

export type ResolvedAction =
  | {
      kind: "addNode";
      agentType: string;
      adapterKind: AdapterKind;
      workingDirectoryRequired: boolean;
      name: string;
      tempId?: string;
      config?: Record<string, unknown>;
      workingDirectory?: string | null;
      position?: { x: number; y: number };
    }
  | { kind: "renameNode"; nodeId: string; newName: string }
  | { kind: "removeNode"; nodeId: string }
  | { kind: "connect"; fromId: string; toId: string }
  | { kind: "disconnect"; edgeId: string }
  | { kind: "setProfile"; nodeId: string; profileId: string }
  | { kind: "startNode"; nodeId: string; agentType: string; workingDirectory: string | null; config: Record<string, unknown> }
  | { kind: "stopNode"; nodeId: string }
  | { kind: "restartNode"; nodeId: string }
  | { kind: "markDone"; nodeId: string }
  | { kind: "stopAll" }
  | { kind: "clearAll" }
  | { kind: "runWorkflow" }
  | { kind: "stopWorkflow" }
  | { kind: "retryNode"; nodeId?: string }
  | { kind: "fitView" }
  | { kind: "openHistory" }
  | { kind: "openActivity" }
  | { kind: "changeAgentType"; nodeId: string; agentType: string; adapterKind: AdapterKind };

export interface ResolveOk {
  ok: true;
  action: ResolvedAction;
  description: string;
  destructive: boolean;
}
export interface ResolveError {
  ok: false;
  description: string;
}
export type ResolveResult = ResolveOk | ResolveError;

export interface ResolveContext {
  nodes: TakoNode[];
  edges: TakoEdge[];
  adapters: AdapterManifestSummary[];
  profilesByAgentType: Record<string, AgentProfile[]>;
  selectedNodeId: string | null;
}

/**
 * Searches the canvas for an agent node with a matching name.
 *
 * @example
 * Input:
 *   findNode([apolloNode], "apollo")
 * Output:
 *   [apolloNode]
 */
function findNode(nodes: TakoNode[], ref: string) {
  return nodes.filter(isAgentNode).filter((n) => n.data.name.toLowerCase() === ref.toLowerCase());
}

/**
 * Finds the exact node the user mentioned by name or currently has selected on the canvas.
 *
 * @example
 * Input:
 *   resolveNode([apolloNode], "Apollo", null)
 * Output:
 *   { ok: true, node: apolloNode }
 */
function resolveNode(
  nodes: TakoNode[],
  rawRef: string,
  selectedNodeId: string | null,
): { ok: true; node: ReturnType<typeof findNode>[number] } | ResolveError {
  const ref = normalizeRef(rawRef);
  if (ref === SELECTED_NODE_REF) {
    if (!selectedNodeId) return { ok: false, description: "No node is selected — click a node first or name it directly." };
    const node = nodes.filter(isAgentNode).find((n) => n.id === selectedNodeId);
    if (!node) return { ok: false, description: "The selected node no longer exists." };
    return { ok: true, node };
  }
  const matches = findNode(nodes, ref);
  if (matches.length === 0) return { ok: false, description: `No node named "${ref}".` };
  if (matches.length > 1) return { ok: false, description: `Multiple nodes are named "${ref}" — rename one first.` };
  return { ok: true, node: matches[0] };
}

/**
 * Verifies that the agent the user asked to create is supported and available on their computer.
 *
 * @example
 * Input:
 *   resolveAgent([{ agentType: "claude-code", displayName: "Claude Code", installed: true }], "claude")
 * Output:
 *   { ok: true, entry: { agentType: "claude-code", displayName: "Claude Code", ... } }
 */
function resolveAgent(adapters: AdapterManifestSummary[], ref: string): { ok: true; entry: AdapterManifestSummary } | ResolveError {
  const lower = ref.toLowerCase();
  const matched = adapters.find((a) => a.agentType === lower || a.displayName.toLowerCase().startsWith(lower));
  if (!matched) {
    return { ok: false, description: `No agent matches "${ref}".` };
  }
  if (!matched.installed && matched.agentType !== "bash") {
    return { ok: false, description: `${matched.displayName} CLI is not installed or available on PATH on this machine.` };
  }
  return { ok: true, entry: matched };
}

/**
 * Finds the account profile (like "Work" or "Personal") the user wants to switch an agent to.
 *
 * @example
 * Input:
 *   resolveProfile([{ id: "p1", label: "Work" }], "Work")
 * Output:
 *   { ok: true, profile: { id: "p1", label: "Work" } }
 */
function resolveProfile(profiles: AgentProfile[], ref: string): { ok: true; profile: AgentProfile } | ResolveError {
  const profile = profiles.find((p) => p.label.toLowerCase() === ref.toLowerCase());
  if (!profile) return { ok: false, description: `No profile named "${ref}".` };
  return { ok: true, profile };
}

/**
 * Validates a user command against the real canvas and prepares the exact action Omni needs to execute.
 *
 * @example
 * Input:
 *   resolveAction({ type: "connect", from: "Apollo", to: "Reviewer" }, ctx)
 * Output:
 *   {
 *     ok: true,
 *     action: { kind: "connect", fromId: "node-1", toId: "node-2" },
 *     description: 'Connect "Apollo" → "Reviewer".',
 *     destructive: false
 *   }
 */
export function resolveAction(action: CanvasAction, ctx: ResolveContext): ResolveResult {
  switch (action.type) {
    case "addNode": {
      const agent = resolveAgent(ctx.adapters, action.agentType);
      if (!agent.ok) return agent;
      const name = action.name || agent.entry.displayName;
      return {
        ok: true,
        action: {
          kind: "addNode",
          agentType: agent.entry.agentType,
          adapterKind: agent.entry.kind,
          workingDirectoryRequired: agent.entry.workingDirectoryRequired,
          name,
        },
        description: `Add ${agent.entry.displayName} node "${name}".`,
        destructive: false,
      };
    }
    case "renameNode": {
      const found = resolveNode(ctx.nodes, action.nodeRef, ctx.selectedNodeId);
      if (!found.ok) return found;
      return {
        ok: true,
        action: { kind: "renameNode", nodeId: found.node.id, newName: action.newName },
        description: `Rename "${found.node.data.name}" to "${action.newName}".`,
        destructive: false,
      };
    }
    case "removeNode": {
      const found = resolveNode(ctx.nodes, action.nodeRef, ctx.selectedNodeId);
      if (!found.ok) return found;
      return {
        ok: true,
        action: { kind: "removeNode", nodeId: found.node.id },
        description: `Remove "${found.node.data.name}".`,
        destructive: true,
      };
    }
    case "connect": {
      const from = resolveNode(ctx.nodes, action.from, ctx.selectedNodeId);
      if (!from.ok) return from;
      const to = resolveNode(ctx.nodes, action.to, ctx.selectedNodeId);
      if (!to.ok) return to;
      if (from.node.id === to.node.id) return { ok: false, description: "A node can't connect to itself." };
      return {
        ok: true,
        action: { kind: "connect", fromId: from.node.id, toId: to.node.id },
        description: `Connect "${from.node.data.name}" → "${to.node.data.name}".`,
        destructive: false,
      };
    }
    case "disconnect": {
      const from = resolveNode(ctx.nodes, action.from, ctx.selectedNodeId);
      if (!from.ok) return from;
      const to = resolveNode(ctx.nodes, action.to, ctx.selectedNodeId);
      if (!to.ok) return to;
      const edge = ctx.edges.find((e) => e.source === from.node.id && e.target === to.node.id);
      if (!edge) return { ok: false, description: `"${from.node.data.name}" isn't connected to "${to.node.data.name}".` };
      return {
        ok: true,
        action: { kind: "disconnect", edgeId: edge.id },
        description: `Disconnect "${from.node.data.name}" → "${to.node.data.name}".`,
        destructive: true,
      };
    }
    case "setProfile": {
      const found = resolveNode(ctx.nodes, action.nodeRef, ctx.selectedNodeId);
      if (!found.ok) return found;
      const profiles = ctx.profilesByAgentType[found.node.data.agentType] ?? [];
      const profile = resolveProfile(profiles, action.profileRef);
      if (!profile.ok) return profile;
      return {
        ok: true,
        action: { kind: "setProfile", nodeId: found.node.id, profileId: profile.profile.id },
        description: `Switch "${found.node.data.name}" to profile "${profile.profile.label}".`,
        destructive: false,
      };
    }
    case "startNode": {
      const found = resolveNode(ctx.nodes, action.nodeRef, ctx.selectedNodeId);
      if (!found.ok) return found;
      return {
        ok: true,
        action: {
          kind: "startNode",
          nodeId: found.node.id,
          agentType: found.node.data.agentType,
          workingDirectory: found.node.data.workingDirectory,
          config: found.node.data.config,
        },
        description: `Start "${found.node.data.name}".`,
        destructive: false,
      };
    }
    case "stopNode": {
      const found = resolveNode(ctx.nodes, action.nodeRef, ctx.selectedNodeId);
      if (!found.ok) return found;
      return {
        ok: true,
        action: { kind: "stopNode", nodeId: found.node.id },
        description: `Stop "${found.node.data.name}".`,
        destructive: false,
      };
    }
    case "restartNode": {
      const found = resolveNode(ctx.nodes, action.nodeRef, ctx.selectedNodeId);
      if (!found.ok) return found;
      return {
        ok: true,
        action: { kind: "restartNode", nodeId: found.node.id },
        description: `Restart "${found.node.data.name}".`,
        destructive: false,
      };
    }
    case "markDone": {
      const found = resolveNode(ctx.nodes, action.nodeRef, ctx.selectedNodeId);
      if (!found.ok) return found;
      return {
        ok: true,
        action: { kind: "markDone", nodeId: found.node.id },
        description: `Mark "${found.node.data.name}" done.`,
        destructive: false,
      };
    }
    case "stopAll":
      return { ok: true, action: { kind: "stopAll" }, description: "Stop all running agents.", destructive: true };
    case "clearAll":
      return { ok: true, action: { kind: "clearAll" }, description: "Remove every node from the canvas.", destructive: true };
    case "runWorkflow":
      return { ok: true, action: { kind: "runWorkflow" }, description: "Run this workflow.", destructive: false };
    case "stopWorkflow":
      return { ok: true, action: { kind: "stopWorkflow" }, description: "Stop the active workflow run.", destructive: true };
    case "retryNode": {
      if (!action.nodeRef) {
        const failedNode = ctx.nodes.filter(isAgentNode).find((n) => n.data.status === "failed" || Boolean(n.data.error));
        if (failedNode) {
          return {
            ok: true,
            action: { kind: "retryNode", nodeId: failedNode.id },
            description: `Retry node "${failedNode.data.name || failedNode.data.agentType}".`,
            destructive: false,
          };
        }
        return {
          ok: true,
          action: { kind: "retryNode" },
          description: "Retry failed node in workflow.",
          destructive: false,
        };
      }
      const found = resolveNode(ctx.nodes, action.nodeRef, ctx.selectedNodeId);
      if (!found.ok) return found;
      return {
        ok: true,
        action: { kind: "retryNode", nodeId: found.node.id },
        description: `Retry node "${found.node.data.name || found.node.data.agentType}".`,
        destructive: false,
      };
    }
    case "changeAgentType": {
      const found = resolveNode(ctx.nodes, action.nodeRef, ctx.selectedNodeId);
      if (!found.ok) return found;
      const agent = resolveAgent(ctx.adapters, action.agentType);
      if (!agent.ok) return agent;
      return {
        ok: true,
        action: { kind: "changeAgentType", nodeId: found.node.id, agentType: agent.entry.agentType, adapterKind: agent.entry.kind },
        description: `Change "${found.node.data.name}" to ${agent.entry.displayName}.`,
        destructive: true,
      };
    }
    case "duplicateNode": {
      const found = resolveNode(ctx.nodes, action.nodeRef, ctx.selectedNodeId);
      if (!found.ok) return found;
      const name = action.name?.trim() || `${found.node.data.name} copy`;
      return {
        ok: true,
        action: {
          kind: "addNode",
          agentType: found.node.data.agentType,
          adapterKind: found.node.data.adapterKind,
          workingDirectoryRequired: false,
          name,
          config: found.node.data.config,
          workingDirectory: found.node.data.workingDirectory,
          position: { x: found.node.position.x + 60, y: found.node.position.y + 60 },
        },
        description: `Create "${name}" (a copy of "${found.node.data.name}").`,
        destructive: false,
      };
    }
    case "fitView": {
      return {
        ok: true,
        action: { kind: "fitView" },
        description: "Fit canvas view to all nodes.",
        destructive: false,
      };
    }
    case "openHistory": {
      return {
        ok: true,
        action: { kind: "openHistory" },
        description: "Open workflow execution history.",
        destructive: false,
      };
    }
    case "openActivity": {
      return {
        ok: true,
        action: { kind: "openActivity" },
        description: "Open live activity timeline.",
        destructive: false,
      };
    }
  }
}

/**
 * Creates a placeholder preview node in memory when the user asks for multi-step commands so the next step knows it exists.
 *
 * @example
 * Input:
 *   makeVirtualAgentNode("Apollo", "claude-code", "terminal", "$new:0")
 * Output:
 *   { id: "$new:0", type: "agentNode", data: { name: "Apollo", ... } }
 */
function makeVirtualAgentNode(name: string, agentType: string, adapterKind: AdapterKind, tempId: string): TakoNode {
  return {
    id: tempId,
    type: "agentNode",
    position: { x: 0, y: 0 },
    data: { name, agentType, adapterKind, workingDirectory: null, config: {}, status: "not_started", error: null, lastActivityAt: null, lastCodeChange: null },
  };
}

/**
 * Resolves a list of commands in order, letting later commands connect to or control nodes created in earlier steps.
 *
 * @example
 * Input:
 *   resolveActionsSequential([
 *     { type: "addNode", agentType: "claude", name: "Apollo" },
 *     { type: "connect", from: "Apollo", to: "Reviewer" }
 *   ], ctx)
 * Output:
 *   [
 *     { ok: true, action: { kind: "addNode", tempId: "$new:0", ... } },
 *     { ok: true, action: { kind: "connect", fromId: "$new:0", toId: "node-2" } }
 *   ]
 */
export function resolveActionsSequential(actions: CanvasAction[], ctx: ResolveContext): ResolveResult[] {
  let virtualNodes = ctx.nodes;
  const results: ResolveResult[] = [];
  let tempCounter = 0;

  for (const action of actions) {
    const result = resolveAction(action, { ...ctx, nodes: virtualNodes });
    if (result.ok && result.action.kind === "addNode") {
      const tempId = `$new:${tempCounter++}`;
      const withTempId: ResolvedAction = { ...result.action, tempId };
      results.push({ ...result, action: withTempId });
      virtualNodes = [...virtualNodes, makeVirtualAgentNode(withTempId.name, withTempId.agentType, withTempId.adapterKind, tempId)];
    } else {
      results.push(result);
    }
  }
  return results;
}

/**
 * Replaces temporary preview IDs with real database IDs once the nodes are actually created on the canvas.
 *
 * @example
 * Input:
 *   substituteTempIds({ kind: "connect", fromId: "$new:0", toId: "real-id-2" }, new Map([["$new:0", "real-id-1"]]))
 * Output:
 *   { kind: "connect", fromId: "real-id-1", toId: "real-id-2" }
 */
export function substituteTempIds(action: ResolvedAction, tempIdToRealId: ReadonlyMap<string, string>): ResolvedAction {
  const real = (id: string) => tempIdToRealId.get(id) ?? id;
  switch (action.kind) {
    case "renameNode":
    case "removeNode":
    case "setProfile":
    case "startNode":
    case "stopNode":
    case "restartNode":
    case "markDone":
    case "changeAgentType":
      return { ...action, nodeId: real(action.nodeId) };
    case "retryNode":
      return action.nodeId ? { ...action, nodeId: real(action.nodeId) } : action;
    case "connect":
      return { ...action, fromId: real(action.fromId), toId: real(action.toId) };
    case "addNode":
    case "disconnect":
    case "stopAll":
    case "clearAll":
    case "runWorkflow":
    case "stopWorkflow":
    case "fitView":
    case "openHistory":
    case "openActivity":
      return action;
  }
}

/**
 * Checks if a pending action is trying to use a node that failed to get created (for instance if the user cancelled the folder picker).
 *
 * @example
 * Input:
 *   referencesUnresolvedTempNode({ kind: "startNode", nodeId: "$new:0", ... })
 * Output:
 *   true
 */
export function referencesUnresolvedTempNode(action: ResolvedAction): boolean {
  const isTemp = (id: string) => id.startsWith("$new:");
  switch (action.kind) {
    case "renameNode":
    case "removeNode":
    case "setProfile":
    case "startNode":
    case "stopNode":
    case "restartNode":
    case "markDone":
    case "changeAgentType":
      return isTemp(action.nodeId);
    case "retryNode":
      return Boolean(action.nodeId && isTemp(action.nodeId));
    case "connect":
      return isTemp(action.fromId) || isTemp(action.toId);
    default:
      return false;
  }
}

const QUERY_BUCKET_VERB: Record<StatusBucket, string> = {
  running: "running",
  waiting: "waiting for your review",
  error: "in an error state",
  completed: "idle or not started",
};

/**
 * Gives a friendly, plain English answer when the user asks a question about their workspace in the command bar.
 *
 * @example
 * Input:
 *   answerCanvasQuery({ type: "countAgents" }, [apolloNode, reviewerNode])
 * Output:
 *   "You have 2 agents."
 */
export function answerCanvasQuery(query: CanvasQuery, nodes: TakoNode[]): string {
  const agentNodes = nodes.filter(isAgentNode);
  if (query.type === "countAgents") {
    if (agentNodes.length === 0) return "You have no agents on the canvas.";
    return `You have ${agentNodes.length} agent${agentNodes.length === 1 ? "" : "s"}.`;
  }
  const matches = agentNodes.filter((n) => statusBucket(n.data.status) === query.bucket);
  if (matches.length === 0) return `No agents are ${QUERY_BUCKET_VERB[query.bucket]}.`;
  return `${STATUS_BUCKET_LABEL[query.bucket]}: ${matches.map((n) => n.data.name).join(", ")}.`;
}
