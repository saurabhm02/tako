import fs from "node:fs";
import path from "node:path";

const cache = new Map<string, boolean>();

/**
 * Clears the saved tool check results so Omni can re-check the user's computer fresh.
 *
 * @example
 * Input:
 *   clearCommandExistsCache()
 * Output:
 *   Saved cache is wiped clean.
 */
export function clearCommandExistsCache(): void {
  cache.clear();
}

/**
 * Checks if a CLI tool is installed on the user's computer so we only show available tools.
 *
 * @example
 * Input:
 *   commandExists("claude")
 * Output:
 *   true (if Claude CLI is installed) or false (if not installed)
 */
export function commandExists(command: string, bypassCache = false): boolean {
  if (!bypassCache) {
    const cached = cache.get(command);
    if (cached !== undefined) return cached;
  }
  const result = scanPath(command);
  cache.set(command, result);
  return result;
}

/**
 * Looks through the system's PATH folders to find where the program file lives.
 *
 * @example
 * Input:
 *   scanPath("node")
 * Output:
 *   true
 */
function scanPath(command: string): boolean {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];

  for (const dir of dirs) {
    for (const ext of extensions) {
      try {
        if (fs.statSync(path.join(dir, command + ext)).isFile()) return true;
      } catch {
        // Not in this directory — keep looking
      }
    }
  }
  return false;
}
