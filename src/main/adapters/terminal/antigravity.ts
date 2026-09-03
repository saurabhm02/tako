import { TerminalAdapter } from "./TerminalAdapter";
import type { AdapterFactoryInput } from "../registry";
import type { Adapter } from "../Adapter";

/**
 * Connects Omni to the Antigravity (`agy`) CLI when the user runs an Antigravity agent node in a folder.
 *
 * @example
 * Input:
 *   createAntigravityAdapter({ nodeId: "1", workingDirectory: "/Users/dev/my-project", config: {}, resumeSessionRef: null })
 * Output:
 *   A running terminal adapter executing "agy" inside "/Users/dev/my-project".
 */
export function createAntigravityAdapter(input: AdapterFactoryInput): Adapter {
  if (!input.workingDirectory) {
    throw new Error("Antigravity requires a working directory");
  }
  return new TerminalAdapter({
    command: "agy",
    args: [],
    workingDirectory: input.workingDirectory,
  });
}
