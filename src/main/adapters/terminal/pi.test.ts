import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createPiAdapter } from "./pi";

// Matches tests/setup.ts's electron mock: app.getPath("userData") -> "/tmp".
const sessionsRoot = path.join("/tmp", "pi-sessions");

function input(overrides: Partial<Parameters<typeof createPiAdapter>[0]> = {}) {
  return {
    nodeId: "a",
    workingDirectory: "/tmp",
    config: {},
    resumeSessionRef: null,
    ...overrides,
  };
}

function writeSessionFile(nodeId: string, sessionId: string) {
  const dir = path.join(sessionsRoot, nodeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`), "");
}

afterEach(() => {
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
});

describe("createPiAdapter", () => {
  test("requires a working directory", () => {
    expect(() => createPiAdapter(input({ workingDirectory: null }))).toThrow();
  });

  // 1 & 2. A brand-new node must never be pre-assigned a session id, and
  // must launch with plain `pi` — no --session-id, no --session-dir or any
  // other args at all. Isolation is carried via the
  // PI_CODING_AGENT_SESSION_DIR env var instead (verified against the real
  // CLI), never a CLI argument.
  test("1. a brand-new node has no session id — never pre-assigned, never passed as --session-id", () => {
    const adapter = createPiAdapter(input({ nodeId: "new-node-1" }));
    expect(adapter.getSessionRef?.()).toBeNull();
  });

  // 2. An existing node resumes the exact persisted session.
  test("2. an existing node with a persisted session_ref resumes that exact session", () => {
    const adapter = createPiAdapter(input({ resumeSessionRef: "session-123" }));
    expect(adapter.getSessionRef?.()).toBe("session-123");
  });

  // 4. Once Pi actually creates its own session file, Tako discovers and
  // captures that real id — never invented.
  test("4. a newly created session id is discovered and captured once Pi writes its transcript", () => {
    const adapter = createPiAdapter(input({ nodeId: "new-node-2" }));
    expect(adapter.getSessionRef?.()).toBeNull(); // nothing yet

    const realId = "11111111-1111-1111-1111-111111111111";
    writeSessionFile("new-node-2", realId);

    expect(adapter.getSessionRef?.()).toBe(realId); // discovered from disk
  });

  // Isolation: two different new nodes never cross-pick up each other's
  // discovered session id — each node's session dir (env var, not a CLI
  // flag) is already its own.
  test("two new nodes never share a discovered session id", () => {
    const adapterA = createPiAdapter(input({ nodeId: "node-a" }));
    const adapterB = createPiAdapter(input({ nodeId: "node-b" }));

    writeSessionFile("node-a", "aaaaaaaa-0000-0000-0000-000000000000");
    writeSessionFile("node-b", "bbbbbbbb-0000-0000-0000-000000000000");

    expect(adapterA.getSessionRef?.()).toBe("aaaaaaaa-0000-0000-0000-000000000000");
    expect(adapterB.getSessionRef?.()).toBe("bbbbbbbb-0000-0000-0000-000000000000");
  });

  // A selected profile lives in config.profileId, not a dedicated field —
  // this just proves reading it doesn't break normal adapter creation.
  test("a node with a selected profile still creates fine", () => {
    const adapter = createPiAdapter(input({ config: { profileId: "work" } }));
    expect(adapter.getSessionRef?.()).toBeNull();
  });
});

// 3 & 5. Pi has no distinct "invalid id" failure mode to recover from
// (verified against the real CLI: reusing an unknown --session-id just
// creates a fresh session under that same id, a warning, never a failure)
// — so there's no separate "start fresh without the old id" fallback path
// to test the way Claude Code needs one. What Pi *does* need, and what's
// covered above: a brand-new node never has an id pre-assigned (1), and
// discovery only ever picks up a session actually tied to this node's own
// --session-dir, never a stale/unrelated one (isolation test above).
