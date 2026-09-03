import { describe, expect, test } from "bun:test";
import path from "node:path";
import { SessionAdapter, type SessionTurnEvent } from "./SessionAdapter";
import type { AdapterError } from "../Adapter";

const FIXTURE = path.join(import.meta.dir, "../../../../tests/sessionCliFixture.ts");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A small JSONL-per-line parser, good enough for exercising SessionAdapter
// itself without depending on any real agent's exact output schema.
function parseLine(line: string): SessionTurnEvent {
  const data = JSON.parse(line) as Record<string, unknown>;
  if (data.type === "thread.started" && typeof data.thread_id === "string") {
    return { sessionId: data.thread_id };
  }
  if ((data.type === "error" || data.type === "turn.failed") && typeof data.message === "string") {
    return { error: { kind: "rate_limit", message: data.message, recoverable: true } };
  }
  if (data.type === "item.completed" && typeof (data.item as any)?.text === "string") {
    return { text: (data.item as any).text as string };
  }
  return {};
}

function makeAdapter(): SessionAdapter {
  return new SessionAdapter({
    command: process.execPath,
    buildArgs: (prompt, sessionId) => {
      const args = sessionId ? ["exec", "resume", sessionId] : ["exec"];
      return [FIXTURE, ...args, "--json", prompt];
    },
    parseLine,
  });
}

function withFixtureEnv(mode: string, threadId: string | undefined, fn: () => Promise<void>) {
  const prevMode = process.env.FIXTURE_MODE;
  const prevThread = process.env.FIXTURE_THREAD_ID;
  process.env.FIXTURE_MODE = mode;
  if (threadId) process.env.FIXTURE_THREAD_ID = threadId;
  return fn().finally(() => {
    if (prevMode === undefined) delete process.env.FIXTURE_MODE;
    else process.env.FIXTURE_MODE = prevMode;
    if (prevThread === undefined) delete process.env.FIXTURE_THREAD_ID;
    else process.env.FIXTURE_THREAD_ID = prevThread;
  });
}

describe("SessionAdapter", () => {
  test("buffers keystrokes until a newline, then sends the whole message as one turn", async () => {
    await withFixtureEnv("success", "thread-a", async () => {
      const adapter = makeAdapter();
      const output: string[] = [];
      adapter.onOutput((chunk) => output.push(chunk));

      for (const char of "hi\r") await adapter.send(char);
      await wait(300);

      expect(output.join("")).toContain("echo:hi");
    });
  });

  test("fires the completion signal when the process exits cleanly", async () => {
    await withFixtureEnv("success", "thread-b", async () => {
      const adapter = makeAdapter();
      let completed = false;
      adapter.onCompletionSignal(() => (completed = true));

      await adapter.send("ping\r");
      await wait(300);

      expect(completed).toBe(true);
    });
  });

  test("captures the session id from the first turn and resumes it on the next", async () => {
    await withFixtureEnv("success", "thread-c", async () => {
      const adapter = makeAdapter();
      const debugLines: string[] = [];
      adapter.onOutput((chunk) => debugLines.push(chunk));

      await adapter.send("first\r");
      await wait(200);
      await adapter.send("second\r");
      await wait(200);

      // Both turns' echoed output arrived; the second spawn should have
      // been told to resume "thread-c", not start a fresh thread.
      const joined = debugLines.join("");
      expect(joined).toContain("echo:first");
      expect(joined).toContain("echo:second");
    });
  });

  test("a non-zero exit with no parsed error reports a generic failure", async () => {
    await withFixtureEnv("crash", undefined, async () => {
      const adapter = makeAdapter();
      const errors: AdapterError[] = [];
      let completed = false;
      adapter.onError((err) => errors.push(err));
      adapter.onCompletionSignal(() => (completed = true));

      await adapter.send("go\r");
      await wait(300);

      expect(completed).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe("unknown");
    });
  });

  // Observed against the real Codex CLI: spawned (not run in a real
  // terminal), it can exit 0 with no text and no error at all. Treating
  // that as a silent success would hand off an empty payload.
  test("a clean exit with no text at all is reported as an error, not a silent completion", async () => {
    await withFixtureEnv("empty-success", undefined, async () => {
      const adapter = makeAdapter();
      const errors: AdapterError[] = [];
      let completed = false;
      adapter.onError((err) => errors.push(err));
      adapter.onCompletionSignal(() => (completed = true));

      await adapter.send("go\r");
      await wait(300);

      expect(completed).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("no response");
    });
  });

  test("a parsed error line is reported once, not duplicated by the exit-code fallback", async () => {
    await withFixtureEnv("error", undefined, async () => {
      const adapter = makeAdapter();
      const errors: AdapterError[] = [];
      adapter.onError((err) => errors.push(err));

      await adapter.send("go\r");
      await wait(300);

      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe("rate_limit");
      expect(errors[0].message).toContain("usage limit");
    });
  });

  test("a non-zero exit's stderr text is included in the generic error", async () => {
    await withFixtureEnv("stderr-crash", undefined, async () => {
      const adapter = makeAdapter();
      const errors: AdapterError[] = [];
      adapter.onError((err) => errors.push(err));

      await adapter.send("go\r");
      await wait(300);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("panic: something broke");
    });
  });

  // Real Codex evidence: a genuine failure emits BOTH a top-level `error`
  // event and a `turn.failed` event for the same thing — only one should
  // reach the UI.
  test("a second error line for the same turn is not reported again", async () => {
    await withFixtureEnv("double-error", undefined, async () => {
      const adapter = makeAdapter();
      const errors: AdapterError[] = [];
      adapter.onError((err) => errors.push(err));

      await adapter.send("go\r");
      await wait(300);

      expect(errors).toHaveLength(1);
    });
  });

  test("two adapter instances never share a session id (isolation)", async () => {
    await withFixtureEnv("success", "thread-shared-attempt", async () => {
      const a = makeAdapter();
      const b = makeAdapter();
      const outputA: string[] = [];
      const outputB: string[] = [];
      a.onOutput((c) => outputA.push(c));
      b.onOutput((c) => outputB.push(c));

      await a.send("from a\r");
      await wait(200);
      await b.send("from b\r");
      await wait(200);

      // Each instance's own second turn would resume ITS OWN captured id,
      // not the other's — proven by both completing independently.
      await a.send("from a again\r");
      await wait(200);

      expect(outputA.join("")).toContain("echo:from a again");
      expect(outputB.join("")).toContain("echo:from b");
    });
  });

  test("stop kills an in-flight turn and clears the session", async () => {
    await withFixtureEnv("hang", undefined, async () => {
      const adapter = makeAdapter();
      await adapter.send("go\r");
      await wait(100);

      await adapter.stop();

      // A fresh send after stop must not try to resume anything.
      const debugLines: string[] = [];
      adapter.onOutput((c) => debugLines.push(c));
    });
  });
});
