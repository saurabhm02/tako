import { ipcMain } from "electron";
import { listAdapterManifest } from "../adapters/registry";
import { commandExists } from "../adapters/commandExists";
import { listProfiles } from "../adapters/profiles";
import type { AdapterManifestSummary } from "../../shared/types";

/**
 * Sets up background listeners so the React UI can ask which CLI tools are installed on the user's computer.
 *
 * @example
 * Input:
 *   registerAdaptersIpc()
 * Output:
 *   The UI can now safely call `window.tako.adapters.list()` to see installed agents.
 */
export function registerAdaptersIpc(): void {
  ipcMain.handle("adapters:list", (): AdapterManifestSummary[] =>
    listAdapterManifest().map((entry) => ({
      agentType: entry.agentType,
      displayName: entry.displayName,
      kind: entry.kind,
      workingDirectoryRequired: entry.workingDirectoryRequired,
      installed: entry.checkCommand ? commandExists(entry.checkCommand, true) : true,
      shortcut: entry.shortcut,
      order: entry.order,
      brandColor: entry.brandColor,
    })),
  );

  ipcMain.handle("adapters:listProfiles", (_event, agentType: string) => listProfiles(agentType));
}
