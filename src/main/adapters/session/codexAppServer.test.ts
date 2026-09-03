import { describe, expect, test } from "bun:test";
import path from "node:path";
import { CodexAppServerAdapter, classifyAppServerError } from "./codexAppServer";
import type { AdapterError } from "../Adapter";

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

function makeAdapter(resumeThreadId: string | null = null): CodexAppServerAdapter {
  return new CodexAppServerAdapter(null, { command: process.execPath, args: [FIXTURE] }, resumeThreadId);
}

describe("CodexAppServerAdapter", () => {
  test("an already-authenticated account starts a thread with no login step", async () => {
    await withFixtureMode("logged-in-success", async () => {
      const adapter = makeAdapter();
      const output: string[] = [];
      adapter.onOutput((chunk) => output.push(chunk));
      await adapter.start();
      expect(output.join("")).not.toContain("sign in");
      await adapter.stop();
    });
  });

  test("a real turn streams deltas, reports usage, and fires the completion signal", async () => {
    await withFixtureMode("logged-in-success", async () => {
      const adapter = makeAdapter();
      const output: string[] = [];
      let completed = false;
      adapter.onOutput((chunk) => output.push(chunk));
      adapter.onCompletionSignal(() => (completed = true));

      await adapter.start();
      await adapter.send("ping\r");
      await wait(150);

      expect(output.join("")).toContain("pong");
      expect(completed).toBe(true);
      // 42 (this turn's own total) not 100 (the fixture's cumulative
      // thread total) — proves per-turn usage is used, not cumulative.
      const usage = adapter.getUsage();
      expect(usage).not.toBe("unknown");
      if (usage === "unknown") throw new Error("unreachable");
      expect(usage.tokensOrUnits).toBe(42);
      // gpt-5 is priced in the table: 10 input + 32 output tokens.
      expect(usage.dollarCost).toBeCloseTo(0.0003325, 10);
      await adapter.stop();
    });
  });

  // The fixture rejects any turn/start whose threadId isn't the one thread
  // created at start() — a passing test here proves the second message
  // reused the existing conversation rather than silently starting a new
  // one (the fixture would otherwise surface a "no active thread"/mismatch
  // error instead of a real reply).
  test("a second message continues the same thread, not a new one", async () => {
    await withFixtureMode("logged-in-success", async () => {
      const adapter = makeAdapter();
      const output: string[] = [];
      const errors: AdapterError[] = [];
      let completions = 0;
      adapter.onOutput((chunk) => output.push(chunk));
      adapter.onError((err) => errors.push(err));
      adapter.onCompletionSignal(() => completions++);

      await adapter.start();
      await adapter.send("first\r");
      await wait(150);
      await adapter.send("second\r");
      await wait(150);

      expect(errors).toEqual([]);
      expect(completions).toBe(2);
      expect(output.join("").match(/pong/g)).toHaveLength(2);
      await adapter.stop();
    });
  });

  test("getSessionRef exposes the thread id so NodeManager can persist it for next launch", async () => {
    await withFixtureMode("logged-in-success", async () => {
      const adapter = makeAdapter();
      expect(adapter.getSessionRef()).toBeNull();

      await adapter.start();

      expect(adapter.getSessionRef()).toBe("thread-1");
      await adapter.stop();
    });
  });

  test("resumes a persisted thread instead of starting a blank one", async () => {
    await withFixtureMode("logged-in-success", async () => {
      const adapter = makeAdapter("thread-1");
      const output: string[] = [];
      adapter.onOutput((chunk) => output.push(chunk));

      await adapter.start();
      await adapter.send("ping\r");
      await wait(150);

      // The fixture rejects turn/start for any thread id it didn't itself
      // create at start() — a real reply proves resume actually reused
      // "thread-1", not silently started a different thread.
      expect(output.join("")).toContain("pong");
      expect(adapter.getSessionRef()).toBe("thread-1");
      await adapter.stop();
    });
  });

  test("a stale/rejected resume id falls back to a fresh thread instead of failing to start", async () => {
    await withFixtureMode("resume-fails", async () => {
      const adapter = makeAdapter("stale-thread");

      await adapter.start(); // must not throw

      expect(adapter.getSessionRef()).toBe("thread-1"); // the fresh thread thread/start hands back, not "stale-thread"
      await adapter.stop();
    });
  });

  test("a model with no known price still reports real token usage, with cost left unknown", async () => {
    await withFixtureMode("unpriced-model", async () => {
      const adapter = makeAdapter();
      adapter.onOutput(() => {});

      await adapter.start();
      await adapter.send("ping\r");
      await wait(150);

      const usage = adapter.getUsage();
      expect(usage).not.toBe("unknown");
      if (usage === "unknown") throw new Error("unreachable");
      expect(usage.tokensOrUnits).toBe(42);
      expect(usage.dollarCost).toBeUndefined();
      await adapter.stop();
    });
  });

  test("a missing session drives account/login/start, opens the browser, and waits for completion", async () => {
    await withFixtureMode("needs-login-success", async () => {
      const adapter = makeAdapter();
      const output: string[] = [];
      adapter.onOutput((chunk) => output.push(chunk));

      await adapter.start();

      expect(output.join("")).toContain("Opening your browser");
      expect(output.join("")).toContain("Signed in");
      await adapter.stop();
    });
  });

  test("a failed login rejects start() with the reported reason", async () => {
    await withFixtureMode("needs-login-fails", async () => {
      const adapter = makeAdapter();
      await expect(adapter.start()).rejects.toThrow("User denied access");
      await adapter.stop();
    });
  });

  test("the app-server exiting mid-login rejects start() instead of hanging", async () => {
    await withFixtureMode("needs-login-exit", async () => {
      const adapter = makeAdapter();
      await expect(adapter.start()).rejects.toThrow();
      await adapter.stop();
    });
  });

  test("a turn error is classified and surfaced without a completion signal", async () => {
    await withFixtureMode("turn-error", async () => {
      const adapter = makeAdapter();
      const errors: AdapterError[] = [];
      let completed = false;
      adapter.onError((err) => errors.push(err));
      adapter.onCompletionSignal(() => (completed = true));

      await adapter.start();
      await adapter.send("go\r");
      await wait(150);

      expect(completed).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe("rate_limit");
    });
  });

  test("the app-server crashing mid-turn surfaces an error and fires onExit", async () => {
    await withFixtureMode("turn-crash", async () => {
      const adapter = makeAdapter();
      const errors: AdapterError[] = [];
      let exited = false;
      adapter.onError((err) => errors.push(err));
      adapter.onExit(() => (exited = true));

      await adapter.start();
      await adapter.send("go\r");
      await wait(150);

      expect(errors.length).toBeGreaterThan(0);
      expect(exited).toBe(true);
    });
  });

  test("sending while a turn is already in progress is rejected, not queued", async () => {
    await withFixtureMode("logged-in-success", async () => {
      const adapter = makeAdapter();
      const errors: AdapterError[] = [];
      adapter.onError((err) => errors.push(err));

      await adapter.start();
      await adapter.send("first\r");
      await adapter.send("second\r");
      await wait(150);

      expect(errors.some((e) => e.message.includes("already in progress"))).toBe(true);
      await adapter.stop();
    });
  });
});

describe("classifyAppServerError", () => {
  test("a usage-limit message is rate_limit", () => {
    expect(classifyAppServerError("You've hit your usage limit.").kind).toBe("rate_limit");
  });

  test("a not-logged-in message is auth", () => {
    expect(classifyAppServerError("You are not logged in. Run `codex login`.").kind).toBe("auth");
  });

  test("anything else falls back to unknown", () => {
    expect(classifyAppServerError("Something went wrong internally.").kind).toBe("unknown");
  });
});
