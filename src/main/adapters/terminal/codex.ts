import { TerminalAdapter } from "./TerminalAdapter";
import {
  createCodexFinalOutputReader,
  defaultCodexHome,
  discoverNewSessionId,
  snapshotExistingSessionFiles,
} from "./codexSession";
import type { AdapterFactoryInput } from "../registry";
import type { Adapter } from "../Adapter";

// The `codex` binary is confirmed installed and authenticated on this
// machine. Session isolation relies on Working Directory (EE3), same
// reasoning as Claude Code/Pi. AP1's Session-mode path (ChatGPT/Codex
// subscription) is the separate `codex-chatgpt` adapter (TICKET-007) —
// this only covers the local Codex CLI.
//
// A brand-new node starts bare `codex` — no --session-id equivalent
// exists on this CLI at all (confirmed via `codex --help`: nothing lets
// you pre-assign a new session's id), so this was already correct. Tako
// discovers whatever id Codex actually picked afterward from its own real
// session store (codexSession.ts — ~/.codex/sessions/**/*.jsonl, each
// file's first line a real session_meta event Codex itself writes).
//
// Resume, verified against the real CLI (not guessed): `codex resume
// <id>` is a real, documented subcommand. `codex exec resume <id>` with an
// unknown id fails cleanly ("no rollout found for thread id <id>"),
// confirmed live — but the bare interactive `codex resume <id>` this
// adapter actually drives was NOT safely verified to fail the same
// observable way (an interactive session doesn't hard-exit the way
// `-p`/`exec` does). Per "don't invent unverified behavior," no automatic
// resume-failure recovery is wired up here, unlike Claude Code — if a
// persisted id turns out to be stale, the real Codex TUI's own behavior is
// what the user sees, same as running it themselves.
export function createCodexAdapter(input: AdapterFactoryInput): Adapter {
  if (!input.workingDirectory) {
    throw new Error("Codex requires a working directory");
  }
  const workingDirectory = input.workingDirectory;
  const codexHome = defaultCodexHome();

  // Known immediately only when resuming a real, persisted session. A new
  // node starts with no id at all — resolveSessionId discovers it from
  // disk once Codex actually creates it.
  let sessionId: string | null = input.resumeSessionRef;
  const existingFiles = sessionId ? null : snapshotExistingSessionFiles(codexHome);

  function resolveSessionId(): string | null {
    if (sessionId) return sessionId;
    if (!existingFiles) return null;
    const discovered = discoverNewSessionId(codexHome, workingDirectory, existingFiles);
    if (discovered) sessionId = discovered;
    return sessionId;
  }

  return new TerminalAdapter({
    command: "codex",
    args: input.resumeSessionRef ? ["resume", input.resumeSessionRef] : [],
    workingDirectory,
    finalOutputReader: createCodexFinalOutputReader(codexHome, resolveSessionId),
    getSessionRef: resolveSessionId,
  });
}
