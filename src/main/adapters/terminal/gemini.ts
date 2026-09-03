import { TerminalAdapter } from "./TerminalAdapter";
import type { AdapterFactoryInput } from "../registry";
import type { Adapter } from "../Adapter";

// Not yet confirmed by a TICKET-005 spike on this machine (no `gemini`
// binary on PATH here) — registered per explicit request, using the same
// Terminal Adapter shape as Claude Code/Pi. Session isolation relies on
// Working Directory (EE3), pending a real spike against the Gemini CLI.
export function createGeminiAdapter(input: AdapterFactoryInput): Adapter {
  if (!input.workingDirectory) {
    throw new Error("Gemini requires a working directory");
  }
  return new TerminalAdapter({
    command: "gemini",
    args: [],
    workingDirectory: input.workingDirectory,
  });
}
