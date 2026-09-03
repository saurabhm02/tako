import { TerminalAdapter } from "./TerminalAdapter";
import type { AdapterFactoryInput } from "../registry";
import type { Adapter } from "../Adapter";

// Unconfirmed: no `kiro` binary on PATH here, and it's not established
// whether Kiro even exposes a bare-invocation terminal CLI the way Claude
// Code/Pi do (docs/03-mvp-tickets.md TICKET-005 flagged this as an open
// question). Registered per explicit request so the node type exists in the
// UI; starting it will surface a clear spawn error until a real spike
// confirms the integration path.
export function createKiroAdapter(input: AdapterFactoryInput): Adapter {
  if (!input.workingDirectory) {
    throw new Error("Kiro requires a working directory");
  }
  return new TerminalAdapter({
    command: "kiro",
    args: [],
    workingDirectory: input.workingDirectory,
  });
}
