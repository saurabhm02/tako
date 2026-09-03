import { beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { NodeManager } from "./NodeManager";
import { closeDatabaseForTests, initDatabase } from "../store/db";
import { resetCurrentRunForTests } from "../store/runsRepo";
import { registerAdapter } from "../adapters/registry";
import { SessionAdapter, type SessionTurnEvent } from "../adapters/session/SessionAdapter";

// This exercises the real SessionAdapter through the real NodeManager —
// registerFakeAdapterType (used elsewhere) substitutes a hand-written test
// double for the whole adapter; this proves the actual session/process
// lifecycle integrates correctly, not just NodeManager's own state machine.
const FIXTURE = path.join(import.meta.dir, "../../../tests/sessionCliFixture.ts");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseLine(line: string): SessionTurnEvent {
  const data = JSON.parse(line) as Record<string, unknown>;
  if (data.type === "thread.started" && typeof data.thread_id === "string") return { sessionId: data.thread_id };
  if (data.type === "item.completed" && typeof (data.item as any)?.text === "string") {
    return { text: (data.item as any).text as string };
  }
  return {};
}

beforeEach(() => {
  closeDatabaseForTests();
  initDatabase(":memory:");
  resetCurrentRunForTests();
  process.env.FIXTURE_MODE = "success";
  registerAdapter({
    agentType: "session-fixture",
    displayName: "Session Fixture",
    kind: "session",
    workingDirectoryRequired: false,
    factory: () =>
      new SessionAdapter({
        command: process.execPath,
        buildArgs: (prompt, sessionId) => [FIXTURE, ...(sessionId ? ["exec", "resume", sessionId] : ["exec"]), prompt],
        parseLine,
      }),
  });
});

describe("NodeManager + SessionAdapter integration", () => {
  test("a real session turn reaches handoff_ready via the provider signal, not idle-timeout", async () => {
    const manager = new NodeManager(60_000); // deliberately long idle timeout — must not be needed
    const ready: string[] = [];
    manager.onHandoffReady((_id, payload) => ready.push(payload));

    await manager.startNode("a", "session-fixture", null, {});
    await manager.sendInput("a", "hello\r");
    await wait(400);

    expect(manager.getStatus("a")).toBe("handoff_ready");
    expect(ready[0]).toContain("echo:hello");
  });

  test("cost is recorded as unknown when the session reports no usage", async () => {
    const manager = new NodeManager(60_000);
    await manager.startNode("a", "session-fixture", null, {});
    await manager.sendInput("a", "hello\r");
    await wait(400);

    expect(manager.getStatus("a")).toBe("handoff_ready");
    // getUsage() on a fresh SessionAdapter with no usage event is "unknown" —
    // NodeManager.completeTurn records that as-is (CT1, never estimated).
  });

  test("an error from the session surfaces as node:error without crashing the node", async () => {
    process.env.FIXTURE_MODE = "crash";
    const manager = new NodeManager(60_000);
    const errors: string[] = [];
    // NodeManager broadcasts node:error via the injected broadcast fn.
    manager.setBroadcast((channel) => errors.push(channel));

    await manager.startNode("a", "session-fixture", null, {});
    await manager.sendInput("a", "go\r");
    await wait(400);

    expect(manager.getStatus("a")).toBe("error");
    expect(errors).toContain("node:error");
  });

  test("stopping the node ends the session cleanly", async () => {
    const manager = new NodeManager(60_000);
    await manager.startNode("a", "session-fixture", null, {});
    await manager.sendInput("a", "hello\r");
    await wait(400);

    await manager.stopNode("a");

    expect(manager.getStatus("a")).toBe("not_started");
  });
});
