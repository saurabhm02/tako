import { NodeRunner } from "./NodeRunner";
import { WorkflowGraphEngine } from "./WorkflowGraphEngine";
import { InMemoryWorkflowRunStore, SqliteWorkflowRunStore } from "../store/workflowRunsRepo";
import { validateWorkflow } from "../../shared/workflowValidation";
import type {
  ConnectionRecord,
  NodeRecord,
  WorkflowRun,
  WorkflowRuntimeEvent,
  WorkflowSnapshot,
} from "../../shared/types";
import type { INodeRunner, IWorkflowRunStore, WorkflowRuntimeOptions } from "./types";

/**
 * Main Workflow Runtime engine that executes workflows, coordinates handoffs between nodes, and manages execution history.
 */
export class WorkflowRuntime {
  private readonly nodeRunner: INodeRunner;
  private readonly maxConcurrency: number;
  private readonly hopLimit: number;
  private readonly store: IWorkflowRunStore;

  private readonly eventListeners = new Set<(event: WorkflowRuntimeEvent) => void>();
  private readonly activeEngines = new Map<string, WorkflowGraphEngine>();
  private readonly cachedWorkflows = new Map<string, { id: string; name: string; nodes: NodeRecord[]; connections: ConnectionRecord[] }>();

  constructor(options?: WorkflowRuntimeOptions) {
    this.nodeRunner = options?.nodeRunner ?? new NodeRunner();
    this.maxConcurrency = options?.maxConcurrency ?? 4;
    this.hopLimit = options?.hopLimit ?? 25;

    if (options?.store) {
      this.store = options.store;
    } else {
      try {
        this.store = new SqliteWorkflowRunStore();
      } catch {
        this.store = new InMemoryWorkflowRunStore();
      }
    }
  }

  /**
   * Listens for live workflow events (like node started, node finished, handoff created) as the workflow runs.
   *
   * @example
   * Input:
   *   runtime.onEvent((event) => console.log(event.type))
   * Output:
   *   Returns an unsubscribe function to stop listening.
   */
  onEvent(listener: (event: WorkflowRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Runs a workflow from start to finish, managing the graph of nodes, passing handoffs, and saving the run.
   *
   * @example
   * Input:
   *   runtime.startWorkflow(myWorkflow, { initialInputs: { "node-1": "Start task" } })
   * Output:
   *   Promise resolving to the final WorkflowRun containing results from all nodes.
   */
  async startWorkflow(
    workflow: WorkflowSnapshot | { id: string; name: string; nodes: NodeRecord[]; connections: ConnectionRecord[] },
    options?: { initialInputs?: Record<string, string>; executionId?: string; validate?: boolean },
  ): Promise<WorkflowRun> {
    if (options?.validate) {
      const validation = validateWorkflow(workflow);
      if (!validation.valid) {
        throw new Error(`Workflow cannot run: ${validation.errors.join("; ")}`);
      }
    }

    const handleEvent = (event: WorkflowRuntimeEvent) => {
      try {
        void this.store.saveEvent(event);
      } catch {
        // Best effort
      }
      for (const listener of this.eventListeners) {
        try {
          listener(event);
        } catch {
          // Prevent listener errors from breaking runtime
        }
      }
    };

    const engine = new WorkflowGraphEngine(
      workflow,
      {
        nodeRunner: this.nodeRunner,
        maxConcurrency: this.maxConcurrency,
        hopLimit: this.hopLimit,
        onEvent: handleEvent,
      },
      options?.executionId,
      options?.initialInputs,
    );

    const initialRun = engine.getRun();
    this.activeEngines.set(initialRun.executionId, engine);
    this.cachedWorkflows.set(initialRun.executionId, workflow);

    try {
      void this.store.saveRun(initialRun);
    } catch {
      // Best effort
    }

    try {
      const finalRun = await engine.execute();
      try {
        void this.store.saveRun(finalRun);
        for (const handoff of finalRun.handoffs) {
          void this.store.saveHandoff(handoff);
        }
      } catch {
        // Best effort
      }
      return finalRun;
    } finally {
      // Keep in active engines so retry remains available
    }
  }

  /**
   * Gets the details of a current or previous workflow run by its ID.
   *
   * @example
   * Input:
   *   runtime.getRun("exec-123")
   * Output:
   *   WorkflowRun object or null if not found.
   */
  async getRun(executionId: string): Promise<WorkflowRun | null> {
    const active = this.activeEngines.get(executionId);
    if (active) {
      return active.getRun();
    }
    return this.store.getRun(executionId);
  }

  /**
   * Lists all previous workflow runs saved on this computer.
   *
   * @example
   * Input:
   *   runtime.listRuns("my-workflow-id")
   * Output:
   *   Array of saved WorkflowRun records.
   */
  async listRuns(workflowId?: string): Promise<WorkflowRun[]> {
    return this.store.listRuns(workflowId);
  }

  /**
   * Cancels an in-progress workflow run and stops all its active agents.
   *
   * @example
   * Input:
   *   runtime.cancelWorkflow("exec-123")
   * Output:
   *   true (if cancellation was triggered)
   */
  async cancelWorkflow(executionId: string): Promise<boolean> {
    const engine = this.activeEngines.get(executionId);
    if (!engine) {
      return false;
    }
    await engine.cancel();
    try {
      void this.store.saveRun(engine.getRun());
    } catch {
      // Best effort
    }
    return true;
  }

  /**
   * Retries a single failed node in a workflow and lets the rest of the workflow continue.
   *
   * @example
   * Input:
   *   runtime.retryNode("exec-123", "node-b")
   * Output:
   *   Updated WorkflowRun after retrying node B and downstream nodes.
   */
  async retryNode(executionId: string, nodeId: string): Promise<WorkflowRun> {
    let engine = this.activeEngines.get(executionId);
    if (!engine) {
      const savedRun = await this.store.getRun(executionId);
      const cachedWorkflow = this.cachedWorkflows.get(executionId);
      if (!savedRun || !cachedWorkflow) {
        throw new Error(`Execution run ${executionId} not found or workflow definition missing`);
      }
      engine = new WorkflowGraphEngine(
        cachedWorkflow,
        {
          nodeRunner: this.nodeRunner,
          maxConcurrency: this.maxConcurrency,
          hopLimit: this.hopLimit,
          onEvent: (event) => {
            void this.store.saveEvent(event);
            for (const listener of this.eventListeners) listener(event);
          },
        },
        executionId,
      );
      this.activeEngines.set(executionId, engine);
    }

    const updatedRun = await engine.retryNode(nodeId);
    try {
      void this.store.saveRun(updatedRun);
      for (const handoff of updatedRun.handoffs) {
        void this.store.saveHandoff(handoff);
      }
    } catch {
      // Best effort
    }
    return updatedRun;
  }
}
