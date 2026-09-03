import { ipcMain } from "electron";
import { getCostSummary } from "../store/costsRepo";

export function registerCostsIpc(): void {
  ipcMain.handle("costs:getSummary", () => getCostSummary());
}
