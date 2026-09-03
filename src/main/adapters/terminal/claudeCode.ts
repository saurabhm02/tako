import { TerminalAdapter } from "./TerminalAdapter";
import {
  createClaudeCodeFinalOutputReader,
  createClaudeCodeUsageReader,
  discoverNewSessionId,
  snapshotExistingSessionFiles,
} from "./claudeCodeUsage";
import { profileConfigDir, profileEnv } from "../profiles";
import type { AdapterFactoryInput } from "../registry";
import type { Adapter } from "../Adapter";

// installed and interactive on bare invocation. Session isolation relies on
// each node's own Working Directory (EE3) — same as using Claude Code
// outside Tako.
//
// A brand-new node starts exactly the way a person would type it
// themselves — bare `claude`, no --session-id — and lets Claude create its
// own session. Pre-assigning an id ourselves was tried and rejected: it's
// not "starting normally," it's Tako dictating an identity the agent never
// asked for. Instead Tako discovers whatever id Claude actually picked
// afterward, from its own real transcript directory (claudeCodeUsage.ts's
// snapshotExistingSessionFiles/discoverNewSessionId — real on-disk
// evidence, never scraped from the terminal's own text, ADR-0002).
//
// Resume, verified against the real CLI (not guessed): `claude --resume
// <id>` reuses that exact session id and replays its real transcript, both
// in `-p` and in a real interactive pty. An id that's missing/expired
// prints "No conversation found with session ID: <id>" and exits
// immediately (code 1) — the shell underneath stays alive, so
// TerminalAdapter's resumeFallback retypes a bare `claude` (no id) into
// that same shell, exactly like a new node, since a failed resume has no
// valid session left to carry forward.
// The one thing "start fresh" means, used by both a genuinely new node and
// a resume that just failed (no valid session to carry forward, so it's
// functionally the same event): no known id yet, discovered from disk once
// Claude actually creates one. Kept as its own small, real seam — it has
// two real call sites (below) doing the exact same thing, not a
// speculative abstraction — so each behavior is independently testable:
// resolveSessionId's discovery, and startFresh's reset.
export function createSessionResolver(configDir: string, cwd: string, initialSessionId: string | null) {
  let sessionId = initialSessionId;
  let existingFiles = sessionId ? null : snapshotExistingSessionFiles(configDir, cwd);

  function resolveSessionId(): string | null {
    if (sessionId) return sessionId;
    if (!existingFiles) return null;
    const discovered = discoverNewSessionId(configDir, cwd, existingFiles);
    if (discovered) sessionId = discovered;
    return sessionId;
  }

  function startFresh(): void {
    sessionId = null;
    existingFiles = snapshotExistingSessionFiles(configDir, cwd);
  }

  return { resolveSessionId, startFresh };
}

export function createClaudeCodeAdapter(input: AdapterFactoryInput): Adapter {
  if (!input.workingDirectory) {
    throw new Error("Claude Code requires a working directory");
  }
  const workingDirectory = input.workingDirectory;
  const resuming = Boolean(input.resumeSessionRef);
  // The node's selected local account/profile (see profiles.ts) — "" is
  // the agent's own default, same as not having this feature at all.
  const profileId = typeof input.config.profileId === "string" ? input.config.profileId : "";
  const configDir = profileConfigDir("claude-code", profileId);

  const { resolveSessionId, startFresh } = createSessionResolver(configDir, workingDirectory, input.resumeSessionRef);

  return new TerminalAdapter({
    command: "claude",
    args: resuming ? ["--resume", input.resumeSessionRef as string] : [],
    workingDirectory,
    env: profileEnv("claude-code", profileId),
    usageReader: createClaudeCodeUsageReader(workingDirectory, resolveSessionId, configDir),
    finalOutputReader: createClaudeCodeFinalOutputReader(workingDirectory, resolveSessionId, configDir),
    getSessionRef: resolveSessionId,
    resumeFallback: resuming
      ? {
          failurePattern: /No conversation found with session ID/,
          onFallback: () => {
            startFresh(); // no valid session to carry forward — same as a new node
            return [];
          },
        }
      : undefined,
  });
}
