import { dialog, ipcMain, type BrowserWindow } from "electron";

export function registerDialogsIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("dialogs:pickDirectory", async (): Promise<string | null> => {
    const window = getWindow();
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}
