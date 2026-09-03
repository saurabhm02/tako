import { TerminalAdapter } from "./TerminalAdapter";
import type { AdapterFactoryInput } from "../registry";
import type { Adapter } from "../Adapter";

// Not an AI agent at all — a plain real terminal (the user's own login
// shell) for when a node just needs to run real commands, same as any
// other terminal node's underlying mechanism minus the "type an agent
// command in" step. Always available: no CLI to be missing.
export function createBashAdapter(input: AdapterFactoryInput): Adapter {
  if (!input.workingDirectory) {
    throw new Error("Terminal requires a working directory");
  }
  return new TerminalAdapter({
    command: "",
    workingDirectory: input.workingDirectory,
  });
}
