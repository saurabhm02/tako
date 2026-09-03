import { TerminalAdapter } from "./TerminalAdapter";
import type { AdapterFactoryInput } from "../registry";
import type { Adapter } from "../Adapter";

// Unconfirmed: no `kimi` binary on PATH here (docs/03-mvp-tickets.md
// TICKET-005 flagged this as an open question). Registered per explicit
// request so the node type exists in the UI; starting it will surface a
// clear spawn error until a real spike confirms the integration path.
export function createKimiAdapter(input: AdapterFactoryInput): Adapter {
  if (!input.workingDirectory) {
    throw new Error("Kimi requires a working directory");
  }
  return new TerminalAdapter({
    command: "kimi",
    args: [],
    workingDirectory: input.workingDirectory,
  });
}
