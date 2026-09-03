import { ipcMain } from "electron";
import type { CanvasCommandContext } from "../../shared/types";
import { interpretCanvasCommand } from "../llm/interpretCanvasCommand";

export function registerLlmIpc(): void {
  ipcMain.handle("llm:interpretCommand", (_e, text: string, context: CanvasCommandContext) =>
    interpretCanvasCommand(text, context)
  );
}
