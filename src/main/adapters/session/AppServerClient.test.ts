import { describe, expect, test } from "bun:test";
import path from "node:path";
import { AppServerClient } from "./AppServerClient";

const FIXTURE = path.join(import.meta.dir, "../../../../tests/appServerFixture.ts");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function withFixtureMode<T>(mode: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.FIXTURE_MODE;
  process.env.FIXTURE_MODE = mode;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.FIXTURE_MODE;
    else process.env.FIXTURE_MODE = prev;
  });
}

describe("AppServerClient", () => {
  test("a request resolves with the matching response by id", async () => {
    await withFixtureMode("logged-in-success", async () => {
      const client = new AppServerClient();
      client.start(process.execPath, [FIXTURE]);
      const result = await client.request<{ codexHome: string }>("initialize", { clientInfo: { name: "x", version: "1" } });
      expect(result.codexHome).toBe("/fake");
      await client.stop();
    });
  });

  test("notifications (no id) are delivered to listeners, not treated as responses", async () => {
    await withFixtureMode("logged-in-success", async () => {
      const client = new AppServerClient();
      client.start(process.execPath, [FIXTURE]);
      const notifications: string[] = [];
      client.onNotification((n) => notifications.push(n.method));

      await client.request("thread/start", { sandbox: "read-only", cwd: null });
      await client.request("turn/start", { threadId: "thread-1", input: [{ type: "text", text: "hi" }] });
      await wait(100);

      expect(notifications).toContain("item/agentMessage/delta");
      expect(notifications).toContain("turn/completed");
      await client.stop();
    });
  });

  test("a pending request rejects if the process exits first", async () => {
    await withFixtureMode("hang-then-exit", async () => {
      const client = new AppServerClient();
      client.start(process.execPath, [FIXTURE]);

      let rejected = false;
      const pending = client.request("account/read", { refreshToken: false }).catch(() => (rejected = true));
      await wait(60);
      await pending;

      expect(rejected).toBe(true);
    });
  });
});
