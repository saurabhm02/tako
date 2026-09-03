import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClaudeCodeAdapter, createSessionResolver } from "./claudeCode";

function input(overrides: Partial<Parameters<typeof createClaudeCodeAdapter>[0]> = {}) {
  return {
    nodeId: "a",
    workingDirectory: "/tmp",
    config: {},
    resumeSessionRef: null,
    ...overrides,
  };
}

// A real, isolated profile config dir (not the user's actual ~/.claude) so
// discovery tests can create/delete real transcript files freely — same
// convention claudeCodeUsage.test.ts already uses for profile-dir tests.
const testProfile = "tako-claudecode-lifecycle-test";
const testConfigDir = path.join(os.homedir(), `.claude-${testProfile}`);

function projectDir(cwd: string): string {
  return path.join(testConfigDir, "projects", cwd.replace(/\//g, "-"));
}

function writeSessionFile(cwd: string, sessionId: string) {
  const dir = projectDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), "");
}

afterEach(() => {
  fs.rmSync(testConfigDir, { recursive: true, force: true });
});

describe("createClaudeCodeAdapter", () => {
  test("requires a working directory", () => {
    expect(() => createClaudeCodeAdapter(input({ workingDirectory: null }))).toThrow();
  });

  // 1. A brand-new node must never be pre-assigned a session id — the
  // command line createClaudeCodeAdapter builds is computed directly from
  // this same value (`resuming ? ["--resume", id] : []`), so null here
  // means the empty-args branch is what actually ran: bare `claude`, no
  // --session-id. Confirmed literally against the real CLI separately.
  test("1. a brand-new node has no session id — never pre-assigned, never passed as --session-id", () => {
    const adapter = createClaudeCodeAdapter(input({ workingDirectory: "/tmp", config: { profileId: testProfile } }));
    expect(adapter.getSessionRef?.()).toBeNull();
  });

  // 2. An existing node (a real, persisted session_ref) resumes that exact
  // session — the id is known immediately, no discovery needed.
  test("2. an existing node with a persisted session_ref resumes that exact session", () => {
    const adapter = createClaudeCodeAdapter(input({ resumeSessionRef: "session-123" }));
    expect(adapter.getSessionRef?.()).toBe("session-123");
  });

  // 4. Once Claude actually creates its own transcript file, Tako
  // discovers and captures that real id from disk — never invented.
  test("4. a newly created session id is discovered and captured once Claude writes its transcript", () => {
    const cwd = "/tmp/tako-claudecode-new-node-fixture";
    const adapter = createClaudeCodeAdapter(input({ workingDirectory: cwd, config: { profileId: testProfile } }));
    expect(adapter.getSessionRef?.()).toBeNull(); // nothing yet

    const realId = "11111111-1111-1111-1111-111111111111";
    writeSessionFile(cwd, realId);

    expect(adapter.getSessionRef?.()).toBe(realId); // discovered from disk
    fs.rmSync(projectDir(cwd), { recursive: true, force: true });
  });

  // Isolation: two different new nodes never cross-pick up each other's
  // discovered session id, even under the same profile.
  test("two new nodes never share a discovered session id", () => {
    const cwdA = "/tmp/tako-claudecode-new-node-fixture-a";
    const cwdB = "/tmp/tako-claudecode-new-node-fixture-b";
    const adapterA = createClaudeCodeAdapter(input({ nodeId: "a", workingDirectory: cwdA, config: { profileId: testProfile } }));
    const adapterB = createClaudeCodeAdapter(input({ nodeId: "b", workingDirectory: cwdB, config: { profileId: testProfile } }));

    writeSessionFile(cwdA, "aaaaaaaa-0000-0000-0000-000000000000");
    writeSessionFile(cwdB, "bbbbbbbb-0000-0000-0000-000000000000");

    expect(adapterA.getSessionRef?.()).toBe("aaaaaaaa-0000-0000-0000-000000000000");
    expect(adapterB.getSessionRef?.()).toBe("bbbbbbbb-0000-0000-0000-000000000000");

    fs.rmSync(projectDir(cwdA), { recursive: true, force: true });
    fs.rmSync(projectDir(cwdB), { recursive: true, force: true });
  });

  // A selected profile lives in config.profileId, not a dedicated field —
  // this just proves reading it doesn't break normal adapter creation.
  test("a node with a selected profile still creates fine", () => {
    const adapter = createClaudeCodeAdapter(input({ config: { profileId: "saurabh" } }));
    expect(adapter.getSessionRef?.()).toBeNull();
  });

  // Verified against the real CLI: Claude Code shares/resumes a session
  // across different CLAUDE_CONFIG_DIR values for the same project when it
  // completed normally — profile switching must always attempt the
  // persisted session id and let Claude itself decide if it's valid
  // (TerminalAdapter's resumeFallback handles it when it isn't). Locks in
  // the "no profileId+workingDirectory session scoping" decision.
  test("Default → Saurabh still attempts to resume the same persisted session id", () => {
    const onDefault = createClaudeCodeAdapter(input({ resumeSessionRef: "shared-session" }));
    const onSaurabh = createClaudeCodeAdapter(input({ resumeSessionRef: "shared-session", config: { profileId: "saurabh" } }));

    expect(onDefault.getSessionRef?.()).toBe("shared-session");
    expect(onSaurabh.getSessionRef?.()).toBe("shared-session");
  });

  test("Saurabh → Default still attempts to resume the same persisted session id", () => {
    const onSaurabh = createClaudeCodeAdapter(input({ resumeSessionRef: "shared-session", config: { profileId: "saurabh" } }));
    const onDefault = createClaudeCodeAdapter(input({ resumeSessionRef: "shared-session", config: {} }));

    expect(onSaurabh.getSessionRef?.()).toBe("shared-session");
    expect(onDefault.getSessionRef?.()).toBe("shared-session");
  });

  // Repeated switching (Default → Saurabh → Default → Saurabh) must never
  // drift or drop the persisted id — each hop is an independent stop/start
  // in the real app (handleSetProfile), simulated here as a fresh adapter
  // per hop with the same resumeSessionRef NodeManager would keep passing.
  test("repeated switching never drifts from the persisted session id", () => {
    const profiles = ["", "saurabh", "", "saurabh"];
    for (const profileId of profiles) {
      const adapter = createClaudeCodeAdapter(input({ resumeSessionRef: "shared-session", config: { profileId } }));
      expect(adapter.getSessionRef?.()).toBe("shared-session");
    }
  });
});

describe("createSessionResolver (the new-node / failed-resume 'start fresh' contract)", () => {
  const cwd = "/tmp/tako-claudecode-resolver-fixture";

  afterEach(() => {
    fs.rmSync(projectDir(cwd), { recursive: true, force: true });
  });

  // 3. A failed resume must start fresh with no id at all — startFresh()
  // is exactly what TerminalAdapter's resumeFallback.onFallback calls, so
  // proving it resets to null here proves the actual fallback path never
  // retypes a --session-id, matching the new-node contract exactly.
  test("3. starting fresh after a failed resume clears the old id — no id until Claude creates one", () => {
    const resolver = createSessionResolver(testConfigDir, cwd, "invalid-stale-session");
    expect(resolver.resolveSessionId()).toBe("invalid-stale-session"); // resume was attempted with it

    resolver.startFresh();

    expect(resolver.resolveSessionId()).toBeNull(); // no id — never the old one
  });

  // 5. The invalid id is never retried: once fresh, only a genuinely new
  // transcript file (a different id) is ever picked up — never the old,
  // known-invalid one, even if some stale file for it still exists on disk.
  test("5. the invalid session id is never retried, even if a stale file for it still exists", () => {
    writeSessionFile(cwd, "invalid-stale-session"); // pretend a stale file lingers
    const resolver = createSessionResolver(testConfigDir, cwd, "invalid-stale-session");
    resolver.startFresh(); // snapshots "invalid-stale-session" as already-existing

    expect(resolver.resolveSessionId()).toBeNull(); // the stale file doesn't count as "new"

    writeSessionFile(cwd, "genuinely-fresh-session");
    expect(resolver.resolveSessionId()).toBe("genuinely-fresh-session"); // only the real new one
  });
});
