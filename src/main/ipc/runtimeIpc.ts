import { ipcMain } from "electron";
import type { WorkflowRuntime } from "../runtime/WorkflowRuntime";
import type { ConnectionRecord, NodeRecord, WorkflowRun, WorkflowSnapshot } from "../../shared/types";

function isValidWorkflow(
  value: unknown,
): value is WorkflowSnapshot | { id: string; name: string; nodes: NodeRecord[]; connections: ConnectionRecord[] } {
  if (!value || typeof value !== "object") return false;
  const wf = value as Partial<WorkflowSnapshot>;
  return typeof wf.id === "string" && typeof wf.name === "string" && Array.isArray(wf.nodes) && Array.isArray(wf.connections);
}

/**
 * Connects the WorkflowRuntime to Electron IPC handlers so the frontend canvas can run, stop, and retry workflows.
 *
 * @example
 * Input:
 *   registerRuntimeIpc(runtime, broadcast)
 * Output:
 *   Sets up "runtime:start", "runtime:cancel", "runtime:retry", "runtime:getRun", and streams "runtime:event" to the renderer.
 */
export function registerRuntimeIpc(
  runtime: WorkflowRuntime,
  broadcast: (channel: string, payload: unknown) => void,
): () => void {
  ipcMain.handle(
    "runtime:start",
    async (
      _event,
      workflow: unknown,
      options?: { initialInputs?: Record<string, string>; executionId?: string },
    ): Promise<WorkflowRun> => {
      if (!isValidWorkflow(workflow)) {
        throw new Error("runtime:start received an invalid workflow definition");
      }
      return runtime.startWorkflow(workflow, options);
    },
  );

  ipcMain.handle("runtime:cancel", async (_event, executionId: unknown): Promise<boolean> => {
    if (typeof executionId !== "string" || executionId.trim().length === 0) {
      throw new Error("runtime:cancel requires a valid string executionId");
    }
    return runtime.cancelWorkflow(executionId);
  });

  ipcMain.handle("runtime:retry", async (_event, executionId: unknown, nodeId: unknown): Promise<WorkflowRun> => {
    if (typeof executionId !== "string" || typeof nodeId !== "string") {
      throw new Error("runtime:retry requires string executionId and nodeId");
    }
    return runtime.retryNode(executionId, nodeId);
  });

  ipcMain.handle("runtime:getRun", async (_event, executionId: unknown): Promise<WorkflowRun | null> => {
    if (typeof executionId !== "string") {
      throw new Error("runtime:getRun requires a string executionId");
    }
    return runtime.getRun(executionId);
  });

  ipcMain.handle("runtime:listRuns", async (_event, workflowId?: unknown): Promise<WorkflowRun[]> => {
    if (workflowId !== undefined && typeof workflowId !== "string") {
      throw new Error("runtime:listRuns requires an optional string workflowId");
    }
    return runtime.listRuns(workflowId);
  });

  const unsubEvent = runtime.onEvent((event) => {
    broadcast("runtime:event", event);
  });

  return () => {
    ipcMain.removeHandler("runtime:start");
    ipcMain.removeHandler("runtime:cancel");
    ipcMain.removeHandler("runtime:retry");
    ipcMain.removeHandler("runtime:getRun");
    ipcMain.removeHandler("runtime:listRuns");
    unsubEvent();
  };
}
