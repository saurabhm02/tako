// Shared between main and renderer. Field shapes mirror the `nodes`/
// `connections`/`workflows` tables in docs/07-architecture.md §13.

import type { WorkflowRun, WorkflowRuntimeEvent } from "./runtimeTypes";

export type AdapterKind = "terminal" | "session";

// "agent" runs a real adapter (Node Manager, cost tracking, handoffs all
// apply); "note" is a passive workspace object with no adapter and no
// lifecycle; "compare" fans one typed prompt out to its outgoing
// connections (HandoffEngine.proposeForOutgoing) — like "note", it never
// reaches Node Manager, it only ever originates handoffs.
export type NodeKind = "agent" | "note" | "compare";

export interface NodeRecord {
  id: string;
  name: string;
  kind: NodeKind;
  agentType: string;
  adapterKind: AdapterKind;
  workingDirectory: string | null;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface ConnectionRecord {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  autoApprove: boolean;
}

export interface WorkflowSnapshot {
  id: string;
  name: string;
  nodes: NodeRecord[];
  connections: ConnectionRecord[];
}

// Lightweight row for the workflow picker — never carries nodes/connections,
// so listing dozens/hundreds of saved workflows stays a cheap single query.
export interface WorkflowSummary {
  id: string;
  name: string;
  updatedAt: number;
}

// First-launch bootstrap identity — still real, still just one workflow
// among however many a user later saves (CV2's "one active workflow at a
// time" still holds; there's just more than one to choose from now).
export const DEFAULT_WORKFLOW_ID = "default";

// Real completion-detection & runtime execution lifecycle states
export type NodeStatus =
  | "not_started"
  | "starting"
  | "idle"
  | "working"
  | "handoff_ready"
  | "error"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type HandoffStatus = "pending" | "queued" | "rejected" | "delivered";

export interface HandoffSummary {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  payloadText: string;
  edited: boolean;
  autoApproved: boolean;
  status: HandoffStatus;
  createdAt: number;
}

export interface AdapterError {
  kind: "auth" | "network" | "rate_limit" | "crash" | "unknown" | "session_recovered";
  message: string;
  recoverable: boolean;
}

export interface AdapterManifestSummary {
  agentType: string;
  displayName: string;
  kind: AdapterKind;
  workingDirectoryRequired: boolean;
  // Whether this agent's real CLI is actually on PATH on this machine —
  // always true for an agent with nothing to check (the plain Terminal).
  installed: boolean;
  shortcut?: string;
  order?: number;
  brandColor?: string;
}

// A local account/profile a node can launch under (see main/adapters/
// profiles.ts) — "" is the agent's own default, no override. Only agents
// with a real local-profile mechanism (Claude Code, Pi) ever return more
// than that one default entry.
export interface AgentProfile {
  id: string;
  label: string;
}

// CT1: dollarTotal only ever sums real reported numbers — hasUnknown flags
// that at least one entry in scope couldn't be measured, so the total is a
// lower bound, never a guess.
export interface CostTotals {
  dollarTotal: number;
  tokensOrUnits: number;
  hasUnknown: boolean;
}

export interface CostSummary {
  currentRun: CostTotals | null; // null until the first node has ever started
  allTime: CostTotals;
  perNode: Array<{ nodeId: string } & CostTotals>;
}

// §15: the audit trail is a read-model, not a separately-maintained log —
// it's the ordered union of node_runs and handoffs rows for one run_id.
export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: number;
  endedAt: number | null;
  status: string;
  hopLimitReachedAt: number | null;
}

export interface NodeRunEvent {
  kind: "node_run";
  nodeId: string;
  agentType: string;
  startedAt: number;
  endedAt: number | null;
  status: NodeStatus;
  finalOutputText: string | null;
}

export interface HandoffEvent {
  kind: "handoff";
  handoffId: string;
  fromNodeId: string;
  fromAgentType: string;
  toNodeId: string;
  toAgentType: string;
  payloadText: string;
  edited: boolean;
  autoApproved: boolean;
  status: HandoffStatus;
  createdAt: number;
  resolvedAt: number | null;
}

// One row per agent turn that actually changed files (git repos only, v1)
// — never sent with diffText/files, so browsing a run's log never pulls a
// potentially-large diff blob over IPC; codeChanges.getDetail fetches that
// lazily, only when "View changes" is actually clicked.
export interface CodeChangeSummaryRow {
  id: string;
  nodeId: string;
  agentType: string;
  // The node's user-given name ("Apollo"), never its raw agentType alone —
  // makes "Apollo → Code changes" unambiguous instead of just "Claude Code
  // → Code changes" when several nodes share an agent type. Optional: the
  // live codeChanges:recorded broadcast (NodeManager, which only tracks
  // agentType, not the canvas-level name) doesn't set it — that entry
  // point already has the node's live name available renderer-side and
  // passes it separately, so callers should fall back to the agent type
  // label when this is absent rather than treat it as required.
  nodeName?: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  truncated: boolean;
  // Another node shared this working directory and was also "working"
  // during this turn — the diff may include its changes too. Never
  // silently attributed to just this agent when true (EE3: Tako doesn't
  // isolate nodes sharing a directory).
  concurrentRisk: boolean;
  createdAt: number;
}

export interface CodeChangeEvent extends CodeChangeSummaryRow {
  kind: "code_change";
}

export interface CodeChangeFile {
  path: string;
  oldPath: string | null;
  insertions: number;
  deletions: number;
  binary: boolean;
  status: "added" | "modified" | "deleted" | "renamed";
}

export interface CodeChangeDetail {
  files: CodeChangeFile[];
  diffText: string;
  truncated: boolean;
}

export type RunEvent = NodeRunEvent | HandoffEvent | CodeChangeEvent;

export interface RunDetail {
  run: RunSummary;
  events: RunEvent[];
  runCost: CostTotals;
}

// The one execution contract both the deterministic parser (renderer) and
// the LLM interpreter (main, for API-key safety) must produce — lives here
// (not commandLayer.ts) because main-process code can't import renderer
// code. Same union, same fields, whichever path built it.
export type CanvasAction =
  | { type: "addNode"; agentType: string; name?: string }
  | { type: "renameNode"; nodeRef: string; newName: string }
  | { type: "removeNode"; nodeRef: string }
  | { type: "connect"; from: string; to: string }
  | { type: "disconnect"; from: string; to: string }
  | { type: "setProfile"; nodeRef: string; profileRef: string }
  | { type: "startNode"; nodeRef: string }
  | { type: "stopNode"; nodeRef: string }
  | { type: "restartNode"; nodeRef: string }
  | { type: "markDone"; nodeRef: string }
  | { type: "stopAll" }
  | { type: "clearAll" }
  | { type: "runWorkflow" }
  | { type: "stopWorkflow" }
  | { type: "retryNode"; nodeRef?: string }
  // Swaps a node's underlying agent entirely ("make this use Claude") —
  // distinct from setProfile, which only switches between profiles of the
  // SAME agent type.
  | { type: "changeAgentType"; nodeRef: string; agentType: string }
  // "create another node like this called Tester" — resolves to the same
  // addNode shape (see ResolvedAction in commandLayer.ts), just with the
  // agent type/working directory/config copied from the source node
  // instead of asked for.
  | { type: "duplicateNode"; nodeRef: string; name?: string }
  | { type: "fitView" }
  | { type: "openHistory" }
  | { type: "openActivity" };

// Sent to the LLM as prompt context — deliberately thin: names/types/status
// only, by NAME never id, no working directories, no session ids, no
// terminal output, no secrets, no config values, no cost data. "Minimum
// current canvas context required." `profile` is the human-readable label
// (never the profile id) or null when the node has no profile set.
export interface CanvasCommandContext {
  nodes: Array<{ name: string; agentType: string; status: NodeStatus; profile: string | null }>;
  edges: Array<{ from: string; to: string }>;
  installedAgents: string[];
  selectedNodeName: string | null;
  workflowName: string;
}

// A read-only question about current canvas state ("what's running?", "how
// many agents?") — structurally distinct from CanvasAction on purpose:
// nothing that executes anything can ever be typed as a CanvasQuery, and
// nothing that answers a question can ever be typed as a CanvasAction. The
// answer itself is computed renderer-side from real state (commandLayer.ts
// answerCanvasQuery), never fabricated by the model.
export type CanvasQuery =
  | { type: "countAgents" }
  | { type: "listByStatus"; bucket: "running" | "waiting" | "error" | "completed" };

// What the LLM interpreter produced, once its raw text has passed strict
// validation — either an ordered action batch or a single read-only query,
// never both, never anything else.
export type LlmInterpretation = { kind: "actions"; actions: CanvasAction[] } | { kind: "query"; query: CanvasQuery };

// Distinguishes *why* the LLM path didn't produce actions/a query, so the
// command bar can show "couldn't understand that" separately from "the
// smarter fallback isn't available right now" instead of one flat failure.
export type LlmCommandOutcome =
  | { ok: true; result: LlmInterpretation }
  | { ok: false; reason: "not_configured" | "provider_error" | "invalid_output" };

// Same discriminated-outcome shape as LlmCommandOutcome, for the same
// reason: the command bar needs to tell "nothing was said" apart from "the
// transcription service failed" apart from "voice isn't set up", instead of
// one flat null.
export type VoiceTranscriptionOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: "not_configured" | "provider_error" | "empty" };

export type Unsubscribe = () => void;

export interface TakoBridge {
  workflows: {
    save(snapshot: WorkflowSnapshot): Promise<void>;
    load(id: string): Promise<WorkflowSnapshot | null>;
    list(): Promise<WorkflowSummary[]>;
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;
  };

  adapters: {
    list(): Promise<AdapterManifestSummary[]>;
    listProfiles(agentType: string): Promise<AgentProfile[]>;
  };

  nodes: {
    create(node: NodeRecord): Promise<void>;
    // Resolves to the working directory the node actually started with —
    // may differ from what was passed in when none was given (terminal
    // agents default to the home directory rather than requiring one).
    start(
      nodeId: string,
      agentType: string,
      workingDirectory: string | null,
      config: Record<string, unknown>,
    ): Promise<string | null>;
    stop(nodeId: string): Promise<void>;
    restart(nodeId: string): Promise<void>;
    dispose(nodeId: string): Promise<void>;
    markDone(nodeId: string): Promise<void>;
    sendManualInput(nodeId: string, text: string): Promise<void>;
    resize(nodeId: string, cols: number, rows: number): Promise<void>;
    getOutputBuffer(nodeId: string): Promise<string>;
    getStatus(nodeId: string): Promise<NodeStatus>;
    onOutputChunk(cb: (payload: { nodeId: string; chunk: string }) => void): Unsubscribe;
    onStatusChanged(cb: (payload: { nodeId: string; status: NodeStatus }) => void): Unsubscribe;
    onError(cb: (payload: { nodeId: string; error: AdapterError }) => void): Unsubscribe;
  };

  connections: {
    create(connection: ConnectionRecord): Promise<void>;
    remove(connectionId: string): Promise<void>;
    setAutoApprove(connectionId: string, autoApprove: boolean): Promise<void>;
  };

  handoffs: {
    listPending(): Promise<HandoffSummary[]>;
    edit(handoffId: string, newText: string): Promise<void>;
    approve(handoffId: string): Promise<void>;
    reject(handoffId: string): Promise<void>;
    sendFromNode(nodeId: string, payloadText: string): Promise<void>;
    onPending(cb: (handoff: HandoffSummary) => void): Unsubscribe;
    onResolved(cb: (handoff: HandoffSummary) => void): Unsubscribe;
    onHopLimitReached(cb: (payload: { runId: string }) => void): Unsubscribe;
  };

  costs: {
    getSummary(): Promise<CostSummary>;
    onUpdated(cb: (summary: CostSummary) => void): Unsubscribe;
  };

  history: {
    listRuns(): Promise<RunSummary[]>;
    getRunDetail(runId: string): Promise<RunDetail | null>;
  };

  codeChanges: {
    getDetail(id: string): Promise<CodeChangeDetail | null>;
    // Fires once per real, non-empty code change actually recorded this
    // session — summary only (no diff text), same lazy-detail split as
    // getDetail. Never fires for a zero-change turn.
    onRecorded(cb: (summary: CodeChangeSummaryRow) => void): Unsubscribe;
  };

  dialogs: {
    pickDirectory(): Promise<string | null>;
  };

  git: {
    // null when the directory isn't a git repo (or git isn't installed) —
    // never throws, since this is purely a cosmetic toolbar label.
    getBranch(directory: string): Promise<string | null>;
  };

  llm: {
    // Never throws, always fails closed — see LlmCommandOutcome for the
    // distinct "couldn't understand" vs "not available" failure reasons.
    interpretCommand(text: string, context: CanvasCommandContext): Promise<LlmCommandOutcome>;
  };

  voice: {
    // audio is a single already-recorded buffer, never a stream and never
    // written to disk by either side. Never throws — see
    // VoiceTranscriptionOutcome for the distinct failure reasons.
    transcribe(audio: ArrayBuffer, mimeType: string): Promise<VoiceTranscriptionOutcome>;
    // A plain config check, no audio, no mic permission — lets the command
    // bar warn the user before it ever opens the microphone.
    isAvailable(): Promise<boolean>;
  };

  runtime: {
    start(
      workflow: WorkflowSnapshot | { id: string; name: string; nodes: NodeRecord[]; connections: ConnectionRecord[] },
      options?: { initialInputs?: Record<string, string>; executionId?: string },
    ): Promise<WorkflowRun>;
    cancel(executionId: string): Promise<boolean>;
    retry(executionId: string, nodeId: string): Promise<WorkflowRun>;
    getRun(executionId: string): Promise<WorkflowRun | null>;
    listRuns(workflowId?: string): Promise<WorkflowRun[]>;
    onEvent(cb: (event: WorkflowRuntimeEvent) => void): Unsubscribe;
  };
}

export * from "./runtimeTypes";
