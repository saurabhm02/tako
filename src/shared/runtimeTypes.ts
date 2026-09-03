/**
 * Canonical types for the Workflow Runtime layer.
 * Defines workflow execution states, node execution states, runtime events,
 * and input/output contracts.
 */

/** Canonical runtime execution state for an individual node in a workflow run. */
export type NodeRuntimeState =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

/** Canonical runtime execution state for an overall workflow run. */
export type WorkflowRunState =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Status of a runtime handoff as it moves from source node to target node. */
export type RuntimeHandoffStatus = "created" | "delivered" | "failed";

/** Structured error details returned when a node or workflow fails. */
export interface RuntimeErrorDetails {
  code: string;
  message: string;
  details?: string;
  nodeId?: string;
  executionId?: string;
  recoverable?: boolean;
}

/** Represents a data handoff created when a source node completes. */
export interface RuntimeHandoff {
  id: string;
  executionId: string;
  fromNodeId: string;
  toNodeId: string;
  sourceOutput: string;
  context?: Record<string, unknown>;
  timestamp: number;
  status: RuntimeHandoffStatus;
}

/** Input contract provided to a node when it starts running. */
export interface NodeInput {
  /** Explicit direct input or prompt text. */
  directInput?: string;
  /** Handoffs delivered from upstream completed nodes. */
  upstreamContext?: RuntimeHandoff[];
  /** Persisted context or workflow configuration. */
  persistedContext?: Record<string, unknown>;
}

/** Output contract returned by a node upon successful completion. */
export interface NodeOutput {
  /** The final text answer or output produced by the node. */
  outputText: string;
  /** Optional metadata produced during the run. */
  metadata?: Record<string, unknown>;
  /** Session or thread reference if supported by the adapter. */
  sessionRef?: string | null;
  /** Token or cost usage if reported by the adapter. */
  usage?: { tokensOrUnits?: number; dollarCost?: number };
  /** Artifacts or files produced by the node. */
  artifacts?: Array<{ name: string; path: string; type?: string }>;
}

/** Represents the execution state of one node within a workflow run. */
export interface NodeRun {
  nodeId: string;
  nodeName: string;
  agentType: string;
  status: NodeRuntimeState;
  startedAt: number | null;
  completedAt: number | null;
  input: NodeInput | null;
  output: NodeOutput | null;
  error: RuntimeErrorDetails | null;
  sessionRef: string | null;
}

/** Canonical event types emitted during workflow execution. */
export type WorkflowRuntimeEventType =
  | "WORKFLOW_STARTED"
  | "NODE_QUEUED"
  | "NODE_STARTED"
  | "NODE_OUTPUT"
  | "NODE_COMPLETED"
  | "NODE_FAILED"
  | "NODE_CANCELLED"
  | "HANDOFF_CREATED"
  | "HANDOFF_DELIVERED"
  | "WORKFLOW_COMPLETED"
  | "WORKFLOW_FAILED"
  | "WORKFLOW_CANCELLED";

export interface WorkflowRuntimeEventBase {
  id: string;
  executionId: string;
  workflowId: string;
  type: WorkflowRuntimeEventType;
  timestamp: number;
}

export interface WorkflowStartedEvent extends WorkflowRuntimeEventBase {
  type: "WORKFLOW_STARTED";
  nodeIds: string[];
}

export interface NodeQueuedEvent extends WorkflowRuntimeEventBase {
  type: "NODE_QUEUED";
  nodeId: string;
}

export interface NodeStartedEvent extends WorkflowRuntimeEventBase {
  type: "NODE_STARTED";
  nodeId: string;
  input: NodeInput;
}

export interface NodeOutputEvent extends WorkflowRuntimeEventBase {
  type: "NODE_OUTPUT";
  nodeId: string;
  chunk: string;
}

export interface NodeCompletedEvent extends WorkflowRuntimeEventBase {
  type: "NODE_COMPLETED";
  nodeId: string;
  output: NodeOutput;
}

export interface NodeFailedEvent extends WorkflowRuntimeEventBase {
  type: "NODE_FAILED";
  nodeId: string;
  error: RuntimeErrorDetails;
}

export interface NodeCancelledEvent extends WorkflowRuntimeEventBase {
  type: "NODE_CANCELLED";
  nodeId: string;
}

export interface HandoffCreatedEvent extends WorkflowRuntimeEventBase {
  type: "HANDOFF_CREATED";
  handoff: RuntimeHandoff;
}

export interface HandoffDeliveredEvent extends WorkflowRuntimeEventBase {
  type: "HANDOFF_DELIVERED";
  handoffId: string;
  toNodeId: string;
}

export interface WorkflowCompletedEvent extends WorkflowRuntimeEventBase {
  type: "WORKFLOW_COMPLETED";
  durationMs: number;
}

export interface WorkflowFailedEvent extends WorkflowRuntimeEventBase {
  type: "WORKFLOW_FAILED";
  error: RuntimeErrorDetails;
}

export interface WorkflowCancelledEvent extends WorkflowRuntimeEventBase {
  type: "WORKFLOW_CANCELLED";
}

export type WorkflowRuntimeEvent =
  | WorkflowStartedEvent
  | NodeQueuedEvent
  | NodeStartedEvent
  | NodeOutputEvent
  | NodeCompletedEvent
  | NodeFailedEvent
  | NodeCancelledEvent
  | HandoffCreatedEvent
  | HandoffDeliveredEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent
  | WorkflowCancelledEvent;

/** Represents a single complete execution run of a workflow. */
export interface WorkflowRun {
  executionId: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowRunState;
  startedAt: number;
  completedAt: number | null;
  nodeRuns: Record<string, NodeRun>;
  handoffs: RuntimeHandoff[];
  events: WorkflowRuntimeEvent[];
  error: RuntimeErrorDetails | null;
}
