import { ipcMain } from "electron";
import type { HandoffEngine } from "../handoff-engine/HandoffEngine";

export function registerHandoffsIpc(handoffEngine: HandoffEngine): void {
  ipcMain.handle("handoffs:listPending", () => handoffEngine.listPending());
  ipcMain.handle("handoffs:edit", (_event, handoffId: string, newText: string) =>
    handoffEngine.editPayload(handoffId, newText),
  );
  ipcMain.handle("handoffs:approve", (_event, handoffId: string) => handoffEngine.approve(handoffId));
  ipcMain.handle("handoffs:reject", (_event, handoffId: string) => handoffEngine.reject(handoffId));
  ipcMain.handle("handoffs:sendFromNode", (_event, nodeId: string, payloadText: string) =>
    handoffEngine.proposeForOutgoing(nodeId, payloadText),
  );
}
