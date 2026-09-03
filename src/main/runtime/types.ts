import type {
  NodeInput,
  NodeOutput,
  NodeRecord,
  RuntimeErrorDetails,
  RuntimeHandoff,
  WorkflowRun,
  WorkflowRuntimeEvent,
} from "../../shared/types";
import type { Adapter } from "../adapters/Adapter";

/** Execution context provided to a NodeRunner instance when executing a node. */
export interface NodeRunnerContext {
  executionId: string;
  workflowId: string;
  onOutput?: (chunk: string) => void;
  signal?: AbortSignal;
}

/** Interface for executing a single node within the workflow runtime. */
export interface INodeRunner {
  run(node: NodeRecord, input: NodeInput, context: NodeRunnerContext): Promise<NodeOutput>;
  cancel?(nodeId: string): Promise<void>;
}

/** Pluggable adapter factory type allowing tests or alternative harnesses to supply adapters. */
export type AdapterFactoryFn = (agentType: string, input: {
  nodeId: string;
  workingDirectory: string | null;
  config: Record<string, unknown>;
  resumeSessionRef: string | null;
}) => Adapter;

/** Persistence store interface for storing and retrieving workflow execution runs. */
export interface IWorkflowRunStore {
  saveRun(run: WorkflowRun): Promise<void> | void;
  getRun(executionId: string): Promise<WorkflowRun | null> | WorkflowRun | null;
  listRuns(workflowId?: string): Promise<WorkflowRun[]> | WorkflowRun[];
  saveEvent(event: WorkflowRuntimeEvent): Promise<void> | void;
  saveHandoff(handoff: RuntimeHandoff): Promise<void> | void;
}

/** Options for configuring the Workflow Runtime. */
export interface WorkflowRuntimeOptions {
  /** Custom node runner (defaults to standard dynamic adapter NodeRunner). */
  nodeRunner?: INodeRunner;
  /** Maximum number of independent nodes allowed to execute concurrently (defaults to 4). */
  maxConcurrency?: number;
  /** Maximum number of handoff hops permitted in a single run (defaults to 25). */
  hopLimit?: number;
  /** Persistence store for runs and events (defaults to in-memory / SQLite). */
  store?: IWorkflowRunStore;
}
