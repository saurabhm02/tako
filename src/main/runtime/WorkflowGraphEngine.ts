import { randomUUID } from "node:crypto";
import { findCycles } from "../../shared/graph";
import type {
  ConnectionRecord,
  NodeInput,
  NodeOutput,
  NodeRecord,
  NodeRun,
  RuntimeErrorDetails,
  RuntimeHandoff,
  WorkflowRun,
  WorkflowRuntimeEvent,
} from "../../shared/types";
import type { INodeRunner, NodeRunnerContext } from "./types";

export interface WorkflowGraphEngineOptions {
  nodeRunner: INodeRunner;
  maxConcurrency?: number;
  hopLimit?: number;
  onEvent: (event: WorkflowRuntimeEvent) => void;
}

/**
 * Executes a workflow graph by following connection lines between nodes, passing data across handoffs, and managing concurrency.
 */
export class WorkflowGraphEngine {
  private readonly nodeRunner: INodeRunner;
  private readonly maxConcurrency: number;
  private readonly hopLimit: number;
  private readonly onEvent: (event: WorkflowRuntimeEvent) => void;

  private workflowRun: WorkflowRun;
  private readonly nodesMap = new Map<string, NodeRecord>();
  private readonly incomingEdges = new Map<string, Set<string>>();
  private readonly outgoingEdges = new Map<string, Set<string>>();
  private readonly connectionIdMap = new Map<string, string>();

  private readonly abortController = new AbortController();
  private readonly runningNodeIds = new Set<string>();
  private readonly queuedNodeIds: string[] = [];
  private isExecutionActive = false;
  private executionPromiseResolve?: (run: WorkflowRun) => void;
  private executionPromiseReject?: (err: unknown) => void;

  constructor(
    workflow: { id: string; name: string; nodes: NodeRecord[]; connections: ConnectionRecord[] },
    options: WorkflowGraphEngineOptions,
    executionId?: string,
    initialInputs?: Record<string, string>,
  ) {
    this.nodeRunner = options.nodeRunner;
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.hopLimit = options.hopLimit ?? 25;
    this.onEvent = options.onEvent;

    const execId = executionId ?? randomUUID();
    const now = Date.now();

    const nodeRuns: Record<string, NodeRun> = {};
    for (const node of workflow.nodes) {
      this.nodesMap.set(node.id, node);
      this.incomingEdges.set(node.id, new Set());
      this.outgoingEdges.set(node.id, new Set());

      nodeRuns[node.id] = {
        nodeId: node.id,
        nodeName: node.name || node.agentType,
        agentType: node.agentType,
        status: "idle",
        startedAt: null,
        completedAt: null,
        input: initialInputs?.[node.id] ? { directInput: initialInputs[node.id] } : null,
        output: null,
        error: null,
        sessionRef: null,
      };
    }

    for (const conn of workflow.connections) {
      if (this.nodesMap.has(conn.fromNodeId) && this.nodesMap.has(conn.toNodeId)) {
        this.incomingEdges.get(conn.toNodeId)!.add(conn.fromNodeId);
        this.outgoingEdges.get(conn.fromNodeId)!.add(conn.toNodeId);
        this.connectionIdMap.set(`${conn.fromNodeId}>${conn.toNodeId}`, conn.id);
      }
    }

    this.workflowRun = {
      executionId: execId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: "idle",
      startedAt: now,
      completedAt: null,
      nodeRuns,
      handoffs: [],
      events: [],
      error: null,
    };
  }

  /**
   * Returns the current state of the workflow run.
   *
   * @example
   * Input:
   *   engine.getRun()
   * Output:
   *   { executionId: "exec-1", status: "running", nodeRuns: { ... } }
   */
  getRun(): WorkflowRun {
    return this.workflowRun;
  }

  /**
   * Starts executing the workflow step by step, running initial root nodes first and triggering downstream nodes as their dependencies finish.
   *
   * @example
   * Input:
   *   engine.execute()
   * Output:
   *   Promise resolving to the final WorkflowRun when all nodes finish.
   */
  async execute(): Promise<WorkflowRun> {
    if (this.isExecutionActive) {
      return this.workflowRun;
    }
    this.isExecutionActive = true;
    this.workflowRun.status = "running";
    this.workflowRun.startedAt = Date.now();

    const edgesForCycleCheck = Array.from(this.connectionIdMap.keys()).map((k) => {
      const [from, to] = k.split(">");
      return { from, to };
    });
    const cycles = findCycles(edgesForCycleCheck);
    if (cycles.length > 0) {
      const cycleDescription = cycles.map((c) => c.join(" -> ")).join(", ");
      const error: RuntimeErrorDetails = {
        code: "CYCLIC_DEPENDENCY",
        message: `Graph contains circular dependencies: ${cycleDescription}`,
        executionId: this.workflowRun.executionId,
        recoverable: false,
      };
      this.failWorkflow(error);
      return this.workflowRun;
    }

    const sourceNodeIds = Array.from(this.nodesMap.keys()).filter((nodeId) => {
      return (this.incomingEdges.get(nodeId)?.size ?? 0) === 0;
    });

    this.emitEvent({
      id: randomUUID(),
      executionId: this.workflowRun.executionId,
      workflowId: this.workflowRun.workflowId,
      type: "WORKFLOW_STARTED",
      nodeIds: Array.from(this.nodesMap.keys()),
      timestamp: Date.now(),
    });

    if (sourceNodeIds.length === 0 && this.nodesMap.size > 0) {
      const error: RuntimeErrorDetails = {
        code: "NO_ROOT_NODES",
        message: "No initial root nodes found to start workflow execution",
        executionId: this.workflowRun.executionId,
      };
      this.failWorkflow(error);
      return this.workflowRun;
    }

    if (this.nodesMap.size === 0) {
      this.completeWorkflow();
      return this.workflowRun;
    }

    for (const sourceId of sourceNodeIds) {
      this.queueNode(sourceId);
    }

    return new Promise<WorkflowRun>((resolve, reject) => {
      this.executionPromiseResolve = resolve;
      this.executionPromiseReject = reject;
      this.scheduleNext();
    });
  }

  /**
   * Stops the active workflow immediately, halting any running agent nodes and preventing queued nodes from starting.
   *
   * @example
   * Input:
   *   engine.cancel()
   * Output:
   *   Workflow status changes to "cancelled" and running adapters are stopped.
   */
  async cancel(): Promise<void> {
    if (this.workflowRun.status !== "running" && this.workflowRun.status !== "idle") {
      return;
    }

    this.abortController.abort();
    this.workflowRun.status = "cancelled";
    this.workflowRun.completedAt = Date.now();

    for (const [nodeId, nodeRun] of Object.entries(this.workflowRun.nodeRuns)) {
      if (nodeRun.status !== "completed") {
        nodeRun.status = "cancelled";
        if (this.runningNodeIds.has(nodeId)) {
          nodeRun.completedAt = Date.now();
          this.emitEvent({
            id: randomUUID(),
            executionId: this.workflowRun.executionId,
            workflowId: this.workflowRun.workflowId,
            type: "NODE_CANCELLED",
            nodeId,
            timestamp: Date.now(),
          });
        }
      }
      if (this.runningNodeIds.has(nodeId)) {
        void this.nodeRunner.cancel?.(nodeId);
      }
    }
    this.runningNodeIds.clear();
    this.queuedNodeIds.length = 0;

    this.emitEvent({
      id: randomUUID(),
      executionId: this.workflowRun.executionId,
      workflowId: this.workflowRun.workflowId,
      type: "WORKFLOW_CANCELLED",
      timestamp: Date.now(),
    });

    this.isExecutionActive = false;
    if (this.executionPromiseResolve) {
      this.executionPromiseResolve(this.workflowRun);
    }
  }

  /**
   * Re-runs a failed or blocked node and unblocks its downstream connections so the workflow can finish.
   *
   * @example
   * Input:
   *   engine.retryNode("node-b")
   * Output:
   *   Node B restarts, and once completed, node C runs automatically.
   */
  async retryNode(nodeId: string): Promise<WorkflowRun> {
    const nodeRun = this.workflowRun.nodeRuns[nodeId];
    if (!nodeRun) {
      throw new Error(`Node ${nodeId} does not exist in run`);
    }
    if (nodeRun.status !== "failed" && nodeRun.status !== "blocked") {
      throw new Error(`Node ${nodeId} is in status ${nodeRun.status}, only failed/blocked nodes can be retried`);
    }

    this.workflowRun.status = "running";
    this.workflowRun.completedAt = null;
    this.workflowRun.error = null;
    this.isExecutionActive = true;

    const downstream = this.getReachableDownstream(nodeId);
    for (const downId of downstream) {
      const downRun = this.workflowRun.nodeRuns[downId];
      if (downRun && downRun.status === "blocked") {
        downRun.status = "idle";
        downRun.error = null;
      }
    }

    nodeRun.status = "idle";
    nodeRun.error = null;
    nodeRun.startedAt = null;
    nodeRun.completedAt = null;

    const incomingHandoffs = this.workflowRun.handoffs.filter((h) => h.toNodeId === nodeId && h.status === "delivered");
    nodeRun.input = {
      directInput: nodeRun.input?.directInput,
      upstreamContext: incomingHandoffs,
    };

    this.queueNode(nodeId);

    return new Promise<WorkflowRun>((resolve, reject) => {
      this.executionPromiseResolve = resolve;
      this.executionPromiseReject = reject;
      this.scheduleNext();
    });
  }

  private queueNode(nodeId: string): void {
    const nodeRun = this.workflowRun.nodeRuns[nodeId];
    if (!nodeRun || nodeRun.status === "queued" || nodeRun.status === "running") {
      return;
    }
    nodeRun.status = "queued";
    this.queuedNodeIds.push(nodeId);

    this.emitEvent({
      id: randomUUID(),
      executionId: this.workflowRun.executionId,
      workflowId: this.workflowRun.workflowId,
      type: "NODE_QUEUED",
      nodeId,
      timestamp: Date.now(),
    });
  }

  private scheduleNext(): void {
    if (this.workflowRun.status !== "running" || this.abortController.signal.aborted) {
      return;
    }

    while (this.runningNodeIds.size < this.maxConcurrency && this.queuedNodeIds.length > 0) {
      const nextNodeId = this.queuedNodeIds.shift()!;
      this.runNode(nextNodeId);
    }

    this.checkCompletion();
  }

  private async runNode(nodeId: string): Promise<void> {
    const node = this.nodesMap.get(nodeId);
    const nodeRun = this.workflowRun.nodeRuns[nodeId];
    if (!node || !nodeRun) return;

    this.runningNodeIds.add(nodeId);
    nodeRun.status = "running";
    nodeRun.startedAt = Date.now();

    const input: NodeInput = nodeRun.input ?? {};

    this.emitEvent({
      id: randomUUID(),
      executionId: this.workflowRun.executionId,
      workflowId: this.workflowRun.workflowId,
      type: "NODE_STARTED",
      nodeId,
      input,
      timestamp: Date.now(),
    });

    const context: NodeRunnerContext = {
      executionId: this.workflowRun.executionId,
      workflowId: this.workflowRun.workflowId,
      signal: this.abortController.signal,
      onOutput: (chunk) => {
        this.emitEvent({
          id: randomUUID(),
          executionId: this.workflowRun.executionId,
          workflowId: this.workflowRun.workflowId,
          type: "NODE_OUTPUT",
          nodeId,
          chunk,
          timestamp: Date.now(),
        });
      },
    };

    try {
      const output = await this.nodeRunner.run(node, input, context);
      this.handleNodeSuccess(nodeId, output);
    } catch (err: unknown) {
      this.handleNodeFailure(nodeId, err);
    } finally {
      this.runningNodeIds.delete(nodeId);
      this.scheduleNext();
    }
  }

  private handleNodeSuccess(nodeId: string, output: NodeOutput): void {
    if (this.workflowRun.status === "cancelled" || this.abortController.signal.aborted) {
      return;
    }
    const nodeRun = this.workflowRun.nodeRuns[nodeId];
    if (!nodeRun) return;

    nodeRun.status = "completed";
    nodeRun.completedAt = Date.now();
    nodeRun.output = output;
    nodeRun.sessionRef = output.sessionRef ?? null;

    this.emitEvent({
      id: randomUUID(),
      executionId: this.workflowRun.executionId,
      workflowId: this.workflowRun.workflowId,
      type: "NODE_COMPLETED",
      nodeId,
      output,
      timestamp: Date.now(),
    });

    const outgoing = this.outgoingEdges.get(nodeId) ?? new Set();
    for (const targetId of outgoing) {
      const handoff: RuntimeHandoff = {
        id: randomUUID(),
        executionId: this.workflowRun.executionId,
        fromNodeId: nodeId,
        toNodeId: targetId,
        sourceOutput: output.outputText,
        timestamp: Date.now(),
        status: "created",
      };
      this.workflowRun.handoffs.push(handoff);

      this.emitEvent({
        id: randomUUID(),
        executionId: this.workflowRun.executionId,
        workflowId: this.workflowRun.workflowId,
        type: "HANDOFF_CREATED",
        handoff,
        timestamp: Date.now(),
      });

      this.checkAndQueueDownstream(targetId);
    }
  }

  private checkAndQueueDownstream(targetId: string): void {
    const targetRun = this.workflowRun.nodeRuns[targetId];
    if (!targetRun || targetRun.status !== "idle") return;

    const incoming = this.incomingEdges.get(targetId) ?? new Set();
    const allIncomingCompleted = Array.from(incoming).every(
      (depId) => this.workflowRun.nodeRuns[depId]?.status === "completed",
    );

    if (allIncomingCompleted) {
      const handoffsForTarget = this.workflowRun.handoffs.filter((h) => h.toNodeId === targetId && h.status === "created");
      for (const h of handoffsForTarget) {
        h.status = "delivered";
        this.emitEvent({
          id: randomUUID(),
          executionId: this.workflowRun.executionId,
          workflowId: this.workflowRun.workflowId,
          type: "HANDOFF_DELIVERED",
          handoffId: h.id,
          toNodeId: targetId,
          timestamp: Date.now(),
        });
      }

      targetRun.input = {
        directInput: targetRun.input?.directInput,
        upstreamContext: handoffsForTarget,
      };

      this.queueNode(targetId);
    }
  }

  private handleNodeFailure(nodeId: string, err: unknown): void {
    if (this.workflowRun.status === "cancelled" || this.abortController.signal.aborted) {
      return;
    }
    const nodeRun = this.workflowRun.nodeRuns[nodeId];
    if (!nodeRun) return;

    const errorDetails: RuntimeErrorDetails =
      typeof err === "object" && err !== null && "message" in err
        ? {
            code: (err as { code?: string }).code ?? "NODE_EXECUTION_FAILED",
            message: (err as { message: string }).message,
            details: (err as { details?: string }).details,
            nodeId,
            executionId: this.workflowRun.executionId,
            recoverable: (err as { recoverable?: boolean }).recoverable ?? true,
          }
        : {
            code: "NODE_EXECUTION_FAILED",
            message: String(err),
            nodeId,
            executionId: this.workflowRun.executionId,
          };

    nodeRun.status = "failed";
    nodeRun.completedAt = Date.now();
    nodeRun.error = errorDetails;

    this.emitEvent({
      id: randomUUID(),
      executionId: this.workflowRun.executionId,
      workflowId: this.workflowRun.workflowId,
      type: "NODE_FAILED",
      nodeId,
      error: errorDetails,
      timestamp: Date.now(),
    });

    const downstream = this.getReachableDownstream(nodeId);
    for (const downId of downstream) {
      const downRun = this.workflowRun.nodeRuns[downId];
      if (downRun && downRun.status !== "completed" && downRun.status !== "failed") {
        downRun.status = "blocked";
      }
    }

    this.failWorkflow(errorDetails);
  }

  private getReachableDownstream(startNodeId: string): Set<string> {
    const reachable = new Set<string>();
    const queue = [startNodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of this.outgoingEdges.get(current) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }

    return reachable;
  }

  private completeWorkflow(): void {
    this.workflowRun.status = "completed";
    this.workflowRun.completedAt = Date.now();
    this.isExecutionActive = false;

    const durationMs = (this.workflowRun.completedAt ?? Date.now()) - this.workflowRun.startedAt;

    this.emitEvent({
      id: randomUUID(),
      executionId: this.workflowRun.executionId,
      workflowId: this.workflowRun.workflowId,
      type: "WORKFLOW_COMPLETED",
      durationMs,
      timestamp: Date.now(),
    });

    if (this.executionPromiseResolve) {
      this.executionPromiseResolve(this.workflowRun);
    }
  }

  private failWorkflow(error: RuntimeErrorDetails): void {
    this.workflowRun.status = "failed";
    this.workflowRun.completedAt = Date.now();
    this.workflowRun.error = error;
    this.isExecutionActive = false;

    this.emitEvent({
      id: randomUUID(),
      executionId: this.workflowRun.executionId,
      workflowId: this.workflowRun.workflowId,
      type: "WORKFLOW_FAILED",
      error,
      timestamp: Date.now(),
    });

    if (this.executionPromiseResolve) {
      this.executionPromiseResolve(this.workflowRun);
    }
  }

  private checkCompletion(): void {
    if (this.workflowRun.status !== "running") return;

    if (this.runningNodeIds.size === 0 && this.queuedNodeIds.length === 0) {
      const allStatuses = Object.values(this.workflowRun.nodeRuns).map((nr) => nr.status);
      if (allStatuses.every((s) => s === "completed")) {
        this.completeWorkflow();
      } else if (allStatuses.some((s) => s === "failed")) {
        // Already failed
      } else {
        const uncompleted = Object.values(this.workflowRun.nodeRuns).filter((nr) => nr.status !== "completed");
        if (uncompleted.length > 0) {
          const error: RuntimeErrorDetails = {
            code: "EXECUTION_DEADLOCK",
            message: `Execution halted with uncompleted nodes: ${uncompleted.map((u) => u.nodeId).join(", ")}`,
            executionId: this.workflowRun.executionId,
          };
          this.failWorkflow(error);
        } else {
          this.completeWorkflow();
        }
      }
    }
  }

  private emitEvent(event: WorkflowRuntimeEvent): void {
    this.workflowRun.events.push(event);
    this.onEvent(event);
  }
}
