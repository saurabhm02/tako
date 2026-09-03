import { describe, expect, test } from "bun:test";
import { createCodexAdapter } from "./codex";

// createCodexAdapter resolves session ids against the REAL ~/.codex home
// (Codex has no profile/config-dir override the way Claude Code does) —
// these tests only ever read from it (discovering a *new* file against a
// snapshot taken fresh in-process, which real history never matches), so
// they're safe without writing or deleting anything there. Discovery
// itself — including writing/removing real session files — is fully
// covered in codexSession.test.ts against a throwaway fake home instead.
function input(overrides: Partial<Parameters<typeof createCodexAdapter>[0]> = {}) {
  return {
    nodeId: "a",
    workingDirectory: "/tmp",
    config: {},
    resumeSessionRef: null,
    ...overrides,
  };
}

describe("createCodexAdapter", () => {
  test("requires a working directory", () => {
    expect(() => createCodexAdapter(input({ workingDirectory: null }))).toThrow();
  });

  // 1. Codex's own CLI has no flag at all to pre-assign a new session's
  // id (confirmed via `codex --help`) — a brand-new node must never
  // invent or pass one either.
  test("1. a brand-new node has no session id — never invented, never passed", () => {
    const adapter = createCodexAdapter(input({ workingDirectory: "/tmp/tako-codex-adapter-test-new" }));
    expect(adapter.getSessionRef?.()).toBeNull();
  });

  // 2. An existing node resumes the exact persisted session via the real,
  // documented `codex resume <id>` subcommand.
  test("2. an existing node with a persisted session_ref resumes that exact session", () => {
    const adapter = createCodexAdapter(input({ resumeSessionRef: "session-123" }));
    expect(adapter.getSessionRef?.()).toBe("session-123");
  });
});

// 3 & 5 (failed resume / never retry an invalid id): NOT implemented for
// Codex. `codex exec resume <id>` was verified live to fail cleanly on an
// unknown id ("no rollout found for thread id <id>"), but this adapter
// drives the bare *interactive* `codex resume <id>` — its failure
// behavior was not safely observable in testing (an interactive session
// doesn't hard-exit the way `-p`/`exec` does, and probing it further risked
// hitting unrelated interactive prompts). Per "don't invent unverified
// behavior," no automatic recovery is wired up — a stale persisted id
// surfaces however the real Codex TUI itself handles it, same as a user
// running `codex resume <bad-id>` themselves. Revisit once that failure
// mode is safely verified.
