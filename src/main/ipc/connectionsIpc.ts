import { ipcMain } from "electron";
import type { ConnectionGraph } from "../graph/ConnectionGraph";
import { deleteConnection, getActiveWorkflowId, setConnectionAutoApprove, upsertConnection } from "../store/workflowsRepo";
import type { ConnectionRecord } from "../../shared/types";

export function registerConnectionsIpc(connectionGraph: ConnectionGraph): void {
  ipcMain.handle("connections:create", (_event, connection: ConnectionRecord) => {
    connectionGraph.upsert(connection);
    upsertConnection({ ...connection, workflowId: getActiveWorkflowId() });
  });

  ipcMain.handle("connections:remove", (_event, connectionId: string) => {
    connectionGraph.remove(connectionId);
    deleteConnection(connectionId);
  });

  ipcMain.handle("connections:setAutoApprove", (_event, connectionId: string, autoApprove: boolean) => {
    connectionGraph.setAutoApprove(connectionId, autoApprove);
    setConnectionAutoApprove(connectionId, autoApprove);
  });
}
