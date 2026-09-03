import { ipcMain } from "electron";
import { getCodeChangeDetail } from "../store/codeChangesRepo";

export function registerCodeChangesIpc(): void {
  ipcMain.handle("codeChanges:getDetail", (_event, id: string) => getCodeChangeDetail(id));
}
