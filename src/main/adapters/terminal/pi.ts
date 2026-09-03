import { app } from "electron";
import path from "node:path";
import { TerminalAdapter } from "./TerminalAdapter";
import {
  createPiFinalOutputReader,
  createPiUsageReader,
  discoverNewSessionId,
  snapshotExistingSessionFiles,
} from "./piUsage";
import { profileEnv } from "../profiles";
import type { AdapterFactoryInput } from "../registry";
import type { Adapter } from "../Adapter";

// Spike finding (docs/03-mvp-tickets.md TICKET-005): real CLI, confirmed
// installed and interactive on bare invocation. Isolation (ADR-0004: two Pi
// nodes stay isolated even sharing a working directory or API key) is
// satisfied via the PI_CODING_AGENT_SESSION_DIR env var, not a CLI flag —
// verified live that it redirects Pi's session storage identically to
// --session-dir. A new node must launch as plain `pi`, exactly as a user
// would type it themselves; env vars configure *where* the agent's own
// native session goes, same idea as Claude Code's CLAUDE_CONFIG_DIR
// profile override, without adding anything to the visible command line.
//
// A brand-new node starts with no --session-id at all — verified against
// the real CLI: bare `pi` (with the env var set) runs fine and writes its
// own session file (Pi's own generated id) into that dir. Tako discovers
// that id afterward from the file that appears (piUsage.ts's
// snapshotExistingSessionFiles/discoverNewSessionId) rather than
// pre-assigning one — each node's session dir is already exclusive to it,
// so no cwd/cross-node filtering is needed the way Claude Code's shared
// config dir needs.
//
// Resume, verified against the real CLI (not guessed): `--session-id <id>`
// already IS Pi's resume mechanism — reusing an id that exists in
// --session-dir continues that session's real transcript; reusing one that
// doesn't exist there just creates a fresh session under that id (a
// printed warning, never a failure/non-zero exit) — Pi has no distinct
// failure mode to recover from, unlike Claude Code.
export function createPiAdapter(input: AdapterFactoryInput): Adapter {
  if (!input.workingDirectory) {
    throw new Error("Pi requires a working directory");
  }
  const sessionDir = path.join(
    app.getPath("userData"),
    "pi-sessions",
    input.nodeId,
  );
  // Known immediately only when resuming a real, persisted session. A new
  // node starts with no id at all — resolveSessionId discovers it from
  // disk once Pi actually creates it.
  let sessionId: string | null = input.resumeSessionRef;
  const existingFiles = sessionId ? null : snapshotExistingSessionFiles(sessionDir);

  function resolveSessionId(): string | null {
    if (sessionId) return sessionId;
    if (!existingFiles) return null;
    const discovered = discoverNewSessionId(sessionDir, existingFiles);
    if (discovered) sessionId = discovered;
    return sessionId;
  }

  // The node's selected local account/profile (see profiles.ts) — "" is
  // Pi's own default. Only the account/settings dir moves; session
  // transcripts already live under Tako's own per-node sessionDir above,
  // so the usage reader needs no profile awareness (unlike Claude Code's).
  const profileId = typeof input.config.profileId === "string" ? input.config.profileId : "";
  return new TerminalAdapter({
    command: "pi",
    args: input.resumeSessionRef ? ["--session-id", input.resumeSessionRef] : [],
    workingDirectory: input.workingDirectory,
    env: { ...profileEnv("pi", profileId), PI_CODING_AGENT_SESSION_DIR: sessionDir },
    usageReader: createPiUsageReader(sessionDir, resolveSessionId),
    finalOutputReader: createPiFinalOutputReader(sessionDir, resolveSessionId),
    getSessionRef: resolveSessionId,
  });
}
