import { ipcMain } from "electron";
import { getRunDetail, listRuns } from "../store/runHistoryRepo";

export function registerHistoryIpc(): void {
  ipcMain.handle("history:listRuns", () => listRuns());
  ipcMain.handle("history:getRunDetail", (_event, runId: string) => getRunDetail(runId));
}
