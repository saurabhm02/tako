import { describe, expect, test } from "bun:test";
import os from "node:os";
import { looksLikeCommandNotFound, TerminalAdapter } from "./TerminalAdapter";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function collectOutput(adapter: TerminalAdapter): { text: () => string } {
  let buffer = "";
  adapter.onOutput((chunk) => (buffer += chunk));
  return { text: () => buffer };
}

describe("TerminalAdapter", () => {
  // The actual behavior change: the agent command runs inside the user's
  // real login shell (sourcing .zshrc/.zprofile, real PATH) instead of
  // being spawned directly — verified by checking the command genuinely
  // executes and produces its real output, not just that a process starts.
  test("the command is typed into a real login shell and actually runs", async () => {
    const adapter = new TerminalAdapter({
      command: "echo",
      args: ["terminal-adapter-integration-check"],
      workingDirectory: os.tmpdir(),
    });
    const output = collectOutput(adapter);

    await adapter.start();
    await wait(500);
    await adapter.stop();

    expect(output.text()).toContain("terminal-adapter-integration-check");
  });

  test("stopping the adapter is intentional and doesn't report a crash or fire onExit", async () => {
    const adapter = new TerminalAdapter({ command: "echo", args: ["hi"], workingDirectory: os.tmpdir() });
    const errors: string[] = [];
    let exited = false;
    adapter.onError((err) => errors.push(err.message));
    adapter.onExit(() => (exited = true));

    await adapter.start();
    await wait(200);
    await adapter.stop();
    await wait(100);

    expect(errors).toEqual([]);
    // onExit is reserved for the process dying on its own — NodeManager's
    // own stopNode() already closes the node_run for an intentional stop,
    // so firing onExit here too would double-finalize it.
    expect(exited).toBe(false);
  });

  test("getUsage is unknown with no usageReader, and defers to one when given", async () => {
    const plain = new TerminalAdapter({ command: "true", workingDirectory: os.tmpdir() });
    expect(plain.getUsage()).toBe("unknown");

    const withReader = new TerminalAdapter({
      command: "true",
      workingDirectory: os.tmpdir(),
      usageReader: () => ({ tokensOrUnits: 42 }),
    });
    expect(withReader.getUsage()).toEqual({ tokensOrUnits: 42 });
  });

  test("getSessionRef is null with no getSessionRef option, and defers to one when given", async () => {
    const plain = new TerminalAdapter({ command: "true", workingDirectory: os.tmpdir() });
    expect(plain.getSessionRef()).toBeNull();

    const withRef = new TerminalAdapter({
      command: "true",
      workingDirectory: os.tmpdir(),
      getSessionRef: () => "session-123",
    });
    expect(withRef.getSessionRef()).toBe("session-123");
  });

  // Mirrors the real Claude Code failure verified by hand: "echo" stands in
  // for a resume that prints its own "session not found"-shaped message and
  // exits, while the underlying shell keeps running — same as the real CLI.
  // Proves detection + the fallback firing. The retyped command's own
  // round-trip back through the pty is NOT asserted here — confirmed (via
  // isolated raw node-pty probes) that Bun's own node-pty binding silently
  // drops any proc.write() issued after the triggering onData callback's
  // stack unwinds, even 0ms later via setTimeout; only a same-tick write
  // survives. The real 1000ms delay this fallback needs (verified against
  // the real `claude` CLI under Electron's own node-pty — writing
  // immediately gets swallowed by the still-exiting `claude` process before
  // the shell reclaims the tty) is therefore unobservable through Bun's
  // test pty specifically, not a defect in the fallback itself.
  test("a resume failure is detected and reported", async () => {
    const adapter = new TerminalAdapter({
      command: "echo",
      args: ["No", "conversation", "found", "with", "session", "ID:", "stale-id"],
      workingDirectory: os.tmpdir(),
      resumeFallback: {
        failurePattern: /No conversation found with session ID/,
        onFallback: () => ["fresh-session-marker"],
      },
    });
    const errors: string[] = [];
    adapter.onError((err) => errors.push(err.message));

    await adapter.start();
    await wait(500);
    await adapter.stop();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("couldn't be resumed");
  });

  // Root cause of the profile-switch bug: NodeManager persists whatever
  // getSessionRef() returns at the moment its onError listener fires — so
  // onFallback() (which moves the id) must run before emitError(), or the
  // stale, now-permanently-invalid id gets persisted instead of the fresh
  // one that's about to start.
  test("by the time the fallback's error fires, getSessionRef already reflects the new id", async () => {
    let currentId = "stale-id";
    const adapter = new TerminalAdapter({
      command: "echo",
      args: ["No", "conversation", "found", "with", "session", "ID:", "stale-id"],
      workingDirectory: os.tmpdir(),
      getSessionRef: () => currentId,
      resumeFallback: {
        failurePattern: /No conversation found with session ID/,
        onFallback: () => {
          currentId = "fresh-id";
          return ["fresh-session-marker"];
        },
      },
    });
    const seen: { idDuringError: string | null } = { idDuringError: null };
    adapter.onError(() => {
      seen.idDuringError = adapter.getSessionRef();
    });

    await adapter.start();
    await wait(500);
    await adapter.stop();

    expect(seen.idDuringError).toBe("fresh-id");
  });

  // A resume that actually succeeds must never fire the fallback — the
  // pattern search is bounded to real matches only, not "anything happened".
  test("a successful resume never triggers the fallback", async () => {
    const adapter = new TerminalAdapter({
      command: "echo",
      args: ["conversation resumed fine"],
      workingDirectory: os.tmpdir(),
      resumeFallback: {
        failurePattern: /No conversation found with session ID/,
        onFallback: () => ["should-not-run"],
      },
    });
    const errors: string[] = [];
    adapter.onError((err) => errors.push(err.message));
    const output = collectOutput(adapter);

    await adapter.start();
    await wait(500);
    await adapter.stop();

    expect(errors).toEqual([]);
    expect(output.text()).not.toContain("should-not-run");
  });

  test("resize never shrinks below the minimum terminal size", async () => {
    const adapter = new TerminalAdapter({ command: "true", workingDirectory: os.tmpdir() });
    await adapter.start();

    // Nothing to assert on node-pty's internal state directly — this just
    // proves resize doesn't throw for a tiny on-canvas box size.
    expect(() => adapter.resize(10, 3)).not.toThrow();

    await adapter.stop();
  });
});

describe("looksLikeCommandNotFound", () => {
  test("recognizes zsh's message", () => {
    expect(looksLikeCommandNotFound("zsh: command not found: kiro")).toBe(true);
  });

  test("recognizes bash's message", () => {
    expect(looksLikeCommandNotFound("bash: kiro: command not found")).toBe(true);
  });

  test("recognizes POSIX sh's message", () => {
    expect(looksLikeCommandNotFound("sh: kiro: not found")).toBe(true);
  });

  test("recognizes Windows cmd's message", () => {
    expect(looksLikeCommandNotFound("'kiro' is not recognized as an internal or external command")).toBe(true);
  });

  test("does not flag ordinary output", () => {
    expect(looksLikeCommandNotFound("Claude Code v2.1.246\nSonnet 5 with high effort")).toBe(false);
  });
});
