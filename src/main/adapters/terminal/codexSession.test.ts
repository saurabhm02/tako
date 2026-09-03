import { afterAll, afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCodexFinalOutputReader, discoverNewSessionId, snapshotExistingSessionFiles } from "./codexSession";

// A real, uniquely-named temp dir standing in for ~/.codex — never the
// user's real one, so these tests can freely write/delete without any
// risk to real Codex history.
const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "tako-codex-home-test-"));

function sessionsDir(): string {
  return path.join(codexHome, "sessions", "2026", "01", "01");
}

function rolloutPath(sessionId: string): string {
  return path.join(sessionsDir(), `rollout-2026-01-01T00-00-00-${sessionId}.jsonl`);
}

function writeSessionFile(sessionId: string, cwd: string) {
  fs.mkdirSync(sessionsDir(), { recursive: true });
  const line = JSON.stringify({ type: "session_meta", payload: { session_id: sessionId, cwd } });
  fs.writeFileSync(rolloutPath(sessionId), line + "\n");
}

function eventLine(payload: Record<string, unknown>): string {
  return JSON.stringify({ type: "event_msg", payload });
}

afterEach(() => {
  fs.rmSync(sessionsDir(), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(codexHome, { recursive: true, force: true });
});

describe("discoverNewSessionId", () => {
  test("nothing discovered when no new file has appeared", () => {
    const existing = snapshotExistingSessionFiles(codexHome);
    expect(discoverNewSessionId(codexHome, "/tmp/cwd-a", existing)).toBeNull();
  });

  // 4. A newly created session file for this exact cwd is discovered.
  test("4. discovers a new session file's real id when its cwd matches", () => {
    const existing = snapshotExistingSessionFiles(codexHome);
    writeSessionFile("11111111-1111-1111-1111-111111111111", "/tmp/cwd-a");

    expect(discoverNewSessionId(codexHome, "/tmp/cwd-a", existing)).toBe("11111111-1111-1111-1111-111111111111");
  });

  // Isolation: Codex's session store is flat, not scoped by project the
  // way Claude Code's is — the cwd check inside discoverNewSessionId is
  // what actually keeps a session from a *different* project from ever
  // being picked up as this node's own.
  test("a new session file for a different cwd is never picked up", () => {
    const existing = snapshotExistingSessionFiles(codexHome);
    writeSessionFile("22222222-2222-2222-2222-222222222222", "/tmp/cwd-other");

    expect(discoverNewSessionId(codexHome, "/tmp/cwd-a", existing)).toBeNull();
  });

  test("a pre-existing file (already in the snapshot) is never re-discovered", () => {
    writeSessionFile("33333333-3333-3333-3333-333333333333", "/tmp/cwd-a");
    const existing = snapshotExistingSessionFiles(codexHome); // snapshot taken AFTER the file exists

    expect(discoverNewSessionId(codexHome, "/tmp/cwd-a", existing)).toBeNull();
  });
});

describe("createCodexFinalOutputReader", () => {
  test("no session id yet is null, not empty text", () => {
    const reader = createCodexFinalOutputReader(codexHome, () => null);
    expect(reader()).toBeNull();
  });

  // The core regression: Codex's rollout log interleaves reasoning,
  // web-search, and message events in one stream — only the dedicated
  // task_complete event's own final message may reach the handoff payload.
  test("reports only task_complete's last_agent_message, never reasoning/tool events", () => {
    const sessionId = "44444444-4444-4444-4444-444444444444";
    writeSessionFile(sessionId, "/tmp/cwd-a");
    fs.appendFileSync(
      rolloutPath(sessionId),
      [
        eventLine({ type: "agent_reasoning", text: "thinking about it" }),
        eventLine({ type: "agent_message", message: "checking now" }),
        eventLine({ type: "task_complete", turn_id: "t1", last_agent_message: "The answer is 4." }),
      ].join("\n") + "\n",
    );

    const reader = createCodexFinalOutputReader(codexHome, () => sessionId);
    expect(reader()).toBe("The answer is 4.");
  });

  test("a second call only reads new lines", () => {
    const sessionId = "55555555-5555-5555-5555-555555555555";
    writeSessionFile(sessionId, "/tmp/cwd-a");
    fs.appendFileSync(rolloutPath(sessionId), eventLine({ type: "task_complete", last_agent_message: "first" }) + "\n");

    const reader = createCodexFinalOutputReader(codexHome, () => sessionId);
    expect(reader()).toBe("first");

    fs.appendFileSync(rolloutPath(sessionId), eventLine({ type: "task_complete", last_agent_message: "second" }) + "\n");
    expect(reader()).toBe("second");
  });
});
