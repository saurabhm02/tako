import { execFile } from "node:child_process";
import { ipcMain } from "electron";

export function getBranch(directory: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: directory, timeout: 3000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
}

export function registerGitIpc(): void {
  ipcMain.handle("git:getBranch", (_event, directory: string) => getBranch(directory));
}
