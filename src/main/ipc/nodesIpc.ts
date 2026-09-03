import { ipcMain } from "electron";
import type { NodeManager } from "../node-manager/NodeManager";
import type { ConnectionGraph } from "../graph/ConnectionGraph";
import { ensureNodeExists, ensureWorkflowExists, deleteNode, getActiveWorkflowId } from "../store/workflowsRepo";
import type { NodeRecord } from "../../shared/types";

export function registerNodesIpc(nodeManager: NodeManager, connectionGraph: ConnectionGraph): void {
  ipcMain.handle("nodes:create", (_event, node: NodeRecord) => {
    const workflowId = getActiveWorkflowId();
    ensureWorkflowExists(workflowId, "My Workflow");
    ensureNodeExists({ ...node, workflowId });
  });

  ipcMain.handle(
    "nodes:start",
    (_event, nodeId: string, agentType: string, workingDirectory: string | null, config: Record<string, unknown>) =>
      nodeManager.startNode(nodeId, agentType, workingDirectory, config ?? {}),
  );

  ipcMain.handle("nodes:stop", (_event, nodeId: string) => nodeManager.stopNode(nodeId));

  ipcMain.handle("nodes:restart", (_event, nodeId: string) => nodeManager.restartNode(nodeId));

  ipcMain.handle("nodes:dispose", async (_event, nodeId: string) => {
    await nodeManager.disposeNode(nodeId);
    connectionGraph.removeForNode(nodeId);
    deleteNode(nodeId);
  });

  ipcMain.handle("nodes:markDone", (_event, nodeId: string) => nodeManager.markDone(nodeId));

  ipcMain.handle("nodes:sendManualInput", (_event, nodeId: string, text: string) =>
    nodeManager.sendInput(nodeId, text),
  );

  ipcMain.handle("nodes:resize", (_event, nodeId: string, cols: number, rows: number) =>
    nodeManager.resize(nodeId, cols, rows),
  );

  ipcMain.handle("nodes:getOutputBuffer", (_event, nodeId: string) => nodeManager.getOutputBuffer(nodeId));

  ipcMain.handle("nodes:getStatus", (_event, nodeId: string) => nodeManager.getStatus(nodeId));
}
