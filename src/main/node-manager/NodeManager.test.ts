import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import os from "node:os";
import { NodeManager } from "./NodeManager";
import { closeDatabaseForTests, initDatabase } from "../store/db";
import { getOrCreateCurrentRun, resetCurrentRunForTests } from "../store/runsRepo";
import { closeOrphanedNodeRuns } from "../store/nodeRunsRepo";
import { listRuns } from "../store/runHistoryRepo";
import { registerFakeAdapterType, type FakeAdapter } from "../../../tests/fakeAdapter";
import { getCostSummary } from "../store/costsRepo";
import { ensureNodeExists, ensureWorkflowExists, getNodeRuntimeState, saveNodeRuntimeState } from "../store/workflowsRepo";
import { listCodeChangeSummariesForRun } from "../store/codeChangesRepo";
import { DEFAULT_WORKFLOW_ID } from "../../shared/types";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

// The run-level regression suite below all reads the *displayed* run
// status through runHistoryRepo (the one reliable source of truth), never
// NodeManager's own in-memory status — a bug that only breaks the
// persisted node_runs row would otherwise slip past every other test here.
function currentRunStatus(): string {
  return listRuns().find((r) => r.id === getOrCreateCurrentRun())!.status;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let fakes: Map<string, FakeAdapter>;
// Every started node now arms a real idle-timeout timer (CompletionDetector
// fix). Left running past the end of a test, it fires later against
// whatever database a *different* test file has since swapped in — shut
// every manager's nodes down so no timer survives its own test.
let manager: NodeManager;

beforeEach(() => {
  closeDatabaseForTests();
  initDatabase(":memory:");
  resetCurrentRunForTests();
  fakes = registerFakeAdapterType("fake");
});

afterEach(async () => {
  await manager?.shutdownAll();
});

describe("NodeManager", () => {
  test("starting a node moves it through starting to idle", async () => {
    manager = new NodeManager();
    const statuses: string[] = [];
    manager.onStatusChanged((_id, status) => statuses.push(status));

    await manager.startNode("a", "fake", null, {});

    expect(statuses).toEqual(["starting", "idle"]);
    expect(manager.getStatus("a")).toBe("idle");
  });

  test("sending input moves the node to working and reaches the real adapter", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});

    await manager.sendInput("a", "hello\r");

    expect(manager.getStatus("a")).toBe("working");
    expect(fakes.get("a")!.sent).toEqual(["hello\r"]);
  });

  test("a completion signal while idle (no input sent) is ignored", async () => {
    manager = new NodeManager();
    let handoffReadyCount = 0;
    manager.onHandoffReady(() => handoffReadyCount++);
    await manager.startNode("a", "fake", null, {});

    fakes.get("a")!.emitOutput("startup banner"); // no idle-timeout wired here; use markDone-free path
    await wait(10);

    expect(manager.getStatus("a")).toBe("idle");
    expect(handoffReadyCount).toBe(0);
  });

  test("completion after input reaches handoff_ready with the turn's stripped output as payload", async () => {
    manager = new NodeManager(20);
    const ready: Array<{ nodeId: string; payload: string }> = [];
    manager.onHandoffReady((nodeId, payload) => ready.push({ nodeId, payload }));

    await manager.startNode("a", "fake", null, {});
    await manager.sendInput("a", "what is 2+2?\r");
    fakes.get("a")!.emitOutput("\x1b[31m4\x1b[0m"); // ANSI-colored "4"

    await wait(40);

    expect(manager.getStatus("a")).toBe("handoff_ready");
    expect(ready).toEqual([{ nodeId: "a", payload: "4" }]);
  });

  // Regression for the handoff-payload bug: a handoff must carry only the
  // agent's real final answer, never the input echo/thinking/tool-call/
  // tool-output noise a raw terminal stream mixes it with.
  test("an adapter with a real final-output source sends only that, never the raw turn buffer", async () => {
    manager = new NodeManager(20);
    const finalOutputFakes = registerFakeAdapterType("fake-final-output", { supportsFinalOutput: true });
    const ready: string[] = [];
    manager.onHandoffReady((_id, payload) => ready.push(payload));

    await manager.startNode("a", "fake-final-output", null, {});
    await manager.sendInput("a", "what is 2+2?\r");
    const adapter = finalOutputFakes.get("a")!;
    // Everything a real terminal-based agent's raw stream would mix
    // together for one turn: the echoed input, a thinking/spinner line, a
    // tool call and its shell output, and only then the real answer.
    adapter.emitOutput("what is 2+2?\r\n");
    adapter.emitOutput("Thinking...\r\n");
    adapter.emitOutput("$ python3 -c 'print(2+2)'\r\n4\r\n");
    adapter.emitOutput("The answer is 4.\r\n");
    // The adapter's own structured source reports only the real final
    // answer — distinct from every line above.
    adapter.finalOutput = "The answer is 4.";

    await wait(40);

    expect(manager.getStatus("a")).toBe("handoff_ready");
    expect(ready).toEqual(["The answer is 4."]);
  });

  test("an adapter that supports final output but hasn't resolved it yet (null) falls back to the raw turn buffer", async () => {
    manager = new NodeManager(20);
    const finalOutputFakes = registerFakeAdapterType("fake-final-output-null", { supportsFinalOutput: true });
    const ready: string[] = [];
    manager.onHandoffReady((_id, payload) => ready.push(payload));

    await manager.startNode("a", "fake-final-output-null", null, {});
    await manager.sendInput("a", "go\r");
    const adapter = finalOutputFakes.get("a")!;
    adapter.emitOutput("only the raw buffer exists");
    adapter.finalOutput = null; // e.g. session id not discovered yet

    await wait(40);

    expect(ready).toEqual(["only the raw buffer exists"]);
  });

  test("markDone forces handoff_ready immediately, without waiting for the idle timer", async () => {
    manager = new NodeManager(5000); // deliberately long — markDone must not need to wait for it
    const ready: string[] = [];
    manager.onHandoffReady((_id, payload) => ready.push(payload));

    await manager.startNode("a", "fake", null, {});
    await manager.sendInput("a", "go\r");
    fakes.get("a")!.emitOutput("done");

    manager.markDone("a");

    expect(manager.getStatus("a")).toBe("handoff_ready");
    expect(ready).toEqual(["done"]);
  });

  test("markDone is a no-op once the turn already completed — no duplicate handoff or cost entry", async () => {
    manager = new NodeManager();
    const ready: string[] = [];
    manager.onHandoffReady((_id, payload) => ready.push(payload));

    await manager.startNode("a", "fake", null, {});
    await manager.sendInput("a", "go\r");
    fakes.get("a")!.emitOutput("done");

    manager.markDone("a");
    manager.markDone("a"); // a duplicate click, or a race with an automatic signal
    manager.markDone("a");

    expect(ready).toEqual(["done"]); // fired exactly once, not three times
    expect(getCostSummary().currentRun!.dollarTotal).toBe(0); // "unknown" usage, but only one entry either way
  });

  test("calling markDone before any input was ever sent is a no-op (nothing to complete)", async () => {
    manager = new NodeManager();
    const ready: string[] = [];
    manager.onHandoffReady((_id, payload) => ready.push(payload));

    await manager.startNode("a", "fake", null, {});
    manager.markDone("a"); // still idle — never started a turn

    expect(manager.getStatus("a")).toBe("idle");
    expect(ready).toEqual([]);
  });

  test("output arriving after markDone never reopens the turn (the chatty-TUI regression)", async () => {
    manager = new NodeManager(5000);
    const statuses: string[] = [];
    manager.onStatusChanged((_id, status) => statuses.push(status));

    await manager.startNode("a", "fake", null, {});
    await manager.sendInput("a", "go\r");
    fakes.get("a")!.emitOutput("the real answer");
    manager.markDone("a");

    // Redraw noise (cursor blink, idle chrome) keeps arriving afterward —
    // none of it should move the node off handoff_ready.
    fakes.get("a")!.emitOutput("\x1b[?25l\x1b[H\x1b[?25h");
    fakes.get("a")!.emitOutput("\x1b[?25l\x1b[H\x1b[?25h");

    expect(manager.getStatus("a")).toBe("handoff_ready");
    expect(statuses.filter((s) => s === "working")).toHaveLength(1); // only the original sendInput
  });

  test("a crash sets status to error and preserves the output already produced (ER2)", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    fakes.get("a")!.emitOutput("partial progress before it died");

    fakes.get("a")!.emitError({ kind: "crash", message: "process died", recoverable: false });

    expect(manager.getStatus("a")).toBe("error");
    expect(manager.getOutputBuffer("a")).toBe("partial progress before it died");
  });

  // Regression for the audit's unbounded-output-buffer finding: a long-
  // running session must not grow node.outputBuffer forever.
  test("outputBuffer stays bounded to a trailing window for a long-running node", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    const adapter = fakes.get("a")!;

    // Well past the 200K-char bound.
    for (let i = 0; i < 250; i++) adapter.emitOutput("x".repeat(1000));

    const buffer = manager.getOutputBuffer("a");
    expect(buffer.length).toBeLessThanOrEqual(200_000);
    expect(buffer.length).toBeGreaterThan(0);
  });

  // The bound applies only to the display/history buffer, never to the
  // per-turn buffer the handoff payload fallback is built from —
  // truncating that would silently drop part of a real answer.
  test("a huge turn's output still reaches handoff_ready with the full payload, unaffected by the outputBuffer bound", async () => {
    manager = new NodeManager(20);
    const ready: string[] = [];
    manager.onHandoffReady((_id, payload) => ready.push(payload));
    await manager.startNode("a", "fake", null, {});
    await manager.sendInput("a", "go\r");

    const bigOutput = "y".repeat(250_000);
    fakes.get("a")!.emitOutput(bigOutput);
    await wait(40);

    expect(ready).toEqual([bigOutput]);
  });

  test("stopping a node returns it to not_started and stops the underlying adapter", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});

    await manager.stopNode("a");

    expect(manager.getStatus("a")).toBe("not_started");
    expect(fakes.get("a")!.started).toBe(false);
  });

  // --- Run lifecycle regression suite ---------------------------------
  // A run is "running" ONLY while a real node process/session is alive.
  // These read the run's displayed status the same way Run History does
  // (live-derived from node_runs), not NodeManager's own status field.

  test("1. starting a node makes its run show as running", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});

    expect(currentRunStatus()).toBe("running");
  });

  test("2. stopping a node ends its run", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});

    await manager.stopNode("a");

    expect(currentRunStatus()).toBe("ended");
  });

  test("3. deleting a running node stops its process and ends its run", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});

    await manager.disposeNode("a");

    expect(fakes.get("a")!.started).toBe(false);
    expect(currentRunStatus()).toBe("ended");
  });

  test("7. a process crash finalizes the run immediately, without an explicit stop", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});

    fakes.get("a")!.emitCrash();

    expect(manager.getStatus("a")).toBe("error"); // failure stays visible...
    expect(currentRunStatus()).toBe("ended"); // ...but the run is already closed
  });

  test("8. no orphaned running run survives a crash even before any explicit cleanup runs", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    fakes.get("a")!.emitCrash();

    // The node is gone (crashed) and its Map entry is never touched by a
    // crash alone — disposing it (the UI's own cleanup on an errored node)
    // must not resurrect or double-close anything already closed.
    await manager.disposeNode("a");

    expect(currentRunStatus()).toBe("ended");
  });

  test("6. a second, genuinely running node keeps the run showing as running after the first ends", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    await manager.startNode("b", "fake", null, {});

    await manager.stopNode("a");

    expect(currentRunStatus()).toBe("running"); // b is still alive
  });

  test("5. an app restart's orphan cleanup never touches a run whose nodes already finished normally", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    await manager.stopNode("a");
    const before = currentRunStatus();

    closeOrphanedNodeRuns(); // simulates the one-time startup sweep on the next launch

    expect(currentRunStatus()).toBe(before);
    expect(currentRunStatus()).toBe("ended");
  });

  test("restarting gives the node a fresh session (fresh output, fresh adapter instance)", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    fakes.get("a")!.emitOutput("old session output");
    const firstAdapter = fakes.get("a")!;

    await manager.restartNode("a");

    expect(manager.getOutputBuffer("a")).toBe("");
    expect(fakes.get("a")).not.toBe(firstAdapter);
    expect(manager.getStatus("a")).toBe("idle");
  });

  test("a node's output and session identity survive an app restart (a fresh NodeManager instance)", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    fakes.get("a")!.emitOutput("old session output");
    fakes.get("a")!.sessionRef = "sess-1";

    // Simulates quitting Tako: shutdownAll routes every node through
    // stopNode, which is what actually persists the snapshot — not a
    // separate flush step.
    await manager.shutdownAll();

    const restarted = new NodeManager(); // a real restart never reuses the old instance
    await restarted.startNode("a", "fake", null, {});

    expect(restarted.getOutputBuffer("a")).toBe("old session output");
    expect(fakes.get("a")!.receivedResumeSessionRef).toBe("sess-1");
    await restarted.shutdownAll();
  });

  test("a crashed node's output still survives an app restart", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    fakes.get("a")!.emitOutput("before the crash");

    fakes.get("a")!.emitCrash();

    const restarted = new NodeManager();
    await restarted.startNode("a", "fake", null, {});

    expect(restarted.getOutputBuffer("a")).toBe("before the crash");
    await restarted.shutdownAll();
  });

  // Restoring the canvas on reopen must never imply running it — a node
  // that was persisted (e.g. a Pi node from a previous session) but never
  // explicitly re-started this process has no live adapter, yet its prior
  // output and session id must still be readable for display so the user
  // sees exactly what they left, not a blank card.
  test("a persisted node's output and session id are readable without ever starting it", () => {
    ensureWorkflowExists(DEFAULT_WORKFLOW_ID, "My Workflow");
    ensureNodeExists({
      id: "a",
      workflowId: DEFAULT_WORKFLOW_ID,
      name: "a",
      kind: "agent",
      agentType: "pi",
      adapterKind: "terminal",
      workingDirectory: "/tmp",
      config: {},
      position: { x: 0, y: 0 },
    });
    saveNodeRuntimeState("a", "restored pi output", "pi-session-1");

    manager = new NodeManager();

    expect(manager.getOutputBuffer("a")).toBe("restored pi output");
    expect(manager.getStatus("a")).toBe("not_started"); // nothing was started
  });

  // The actual desired restore behavior: reopening Tako auto-starts every
  // persisted node and resumes its real session (CanvasApp.loadFromDisk),
  // but starting and sending input are two entirely separate calls in this
  // codebase (see sendInput below) — startNode itself never calls it. This
  // is the regression guard for that: resuming must never itself turn into
  // a turn.
  test("auto-starting a node with a persisted session resumes it without ever sending it any input", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    fakes.get("a")!.emitOutput("previous session output");
    fakes.get("a")!.sessionRef = "real-session-1";
    await manager.shutdownAll();

    // Simulates reopening Tako: a fresh NodeManager, and CanvasApp calling
    // startNode for every restored node — the ONLY call it makes.
    const restarted = new NodeManager();
    await restarted.startNode("a", "fake", null, {});

    expect(fakes.get("a")!.receivedResumeSessionRef).toBe("real-session-1"); // real session resumed
    expect(restarted.getOutputBuffer("a")).toContain("previous session output"); // real output restored
    expect(restarted.getStatus("a")).toBe("idle"); // waiting for input, not "working"
    expect(fakes.get("a")!.sent).toEqual([]); // nothing was ever sent on its behalf

    // Explicit user input still starts a completely normal turn afterward.
    await restarted.sendInput("a", "hello\r");
    expect(restarted.getStatus("a")).toBe("working");
    expect(fakes.get("a")!.sent).toEqual(["hello\r"]);

    await restarted.shutdownAll();
  });

  // --- Session lifecycle contract (must hold for every adapter) -------

  // 1. A brand-new node (nothing ever persisted) must never be told to
  // resume anything — the adapter factory receives a null ref and is free
  // to start a normal, fresh session.
  test("1. a new node with no persisted session_ref does not attempt a resume", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});

    expect(fakes.get("a")!.receivedResumeSessionRef).toBeNull();
  });

  // 2. A node that has a persisted session_ref must have that exact id
  // passed through to the adapter factory, so it can attempt a real resume.
  test("2. an existing node with a persisted session_ref resumes that exact session", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    fakes.get("a")!.sessionRef = "persisted-session-42";
    await manager.stopNode("a"); // persists it, the same as a real quit would

    await manager.startNode("a", "fake", null, {});

    expect(fakes.get("a")!.receivedResumeSessionRef).toBe("persisted-session-42");
  });

  // 3 & 4 & 6. The actual profile-switch bug: a resume attempt against a
  // session id invalid for the newly selected profile fails, the adapter
  // silently starts a fresh session, and reports it via onError
  // ("session_recovered") — all before any turn ever completes. The fresh
  // id must become durable the moment that happens (4), not wait for the
  // next turn/stop checkpoint, or quitting in that window leaves the stale,
  // permanently-invalid id persisted and the next launch retries the exact
  // same failed resume forever. The node itself was never actually broken
  // — the adapter already recovered by the time this fires — so final
  // status must land back on "idle" (6), not get stuck at "error" for a
  // problem that's already fixed, and never "working" either.
  test("3&4&6. a failed resume (3) starts fresh, persists the new id immediately (4), final state is idle not error (6)", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    const adapter = fakes.get("a")!;

    expect(getNodeRuntimeState("a").sessionRef).toBeNull(); // nothing persisted yet
    expect(manager.getStatus("a")).toBe("idle");

    adapter.sessionRef = "fresh-after-fallback";
    adapter.emitError({ kind: "session_recovered", message: "resumed fresh", recoverable: true });

    expect(getNodeRuntimeState("a").sessionRef).toBe("fresh-after-fallback"); // new id persisted immediately
    expect(manager.getStatus("a")).toBe("idle"); // ready, never stuck at "error" or "working"
  });

  // A genuinely broken node (not a silent recovery) must still surface as
  // "error" — the new "session_recovered" kind is the only one exempted
  // from this, every other kind (including a plain "unknown" error with no
  // recovery) keeps the existing, correct behavior.
  test("a real (non-recovered) error still sets status to error", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    const adapter = fakes.get("a")!;

    adapter.emitError({ kind: "unknown", message: "genuinely broken", recoverable: true });

    expect(manager.getStatus("a")).toBe("error");
  });

  // 5. Never retry a known-invalid session id: once the fresh id is
  // persisted (previous test), the NEXT start — the next real app launch,
  // or a profile switch's own stop+start — must read that fresh id back out
  // of the DB and pass it on, never the original, now-permanently-invalid one.
  test("5. an invalid session id is never retried on the next start", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});
    const first = fakes.get("a")!;
    first.sessionRef = "fresh-after-fallback";
    first.emitError({ kind: "session_recovered", message: "resumed fresh", recoverable: true });
    await manager.stopNode("a");

    await manager.startNode("a", "fake", null, {});
    const second = fakes.get("a")!;

    expect(second.receivedResumeSessionRef).toBe("fresh-after-fallback");
    expect(second.receivedResumeSessionRef).not.toBe("stale-original-id");
  });

  test("disposing a node forgets it entirely", async () => {
    manager = new NodeManager();
    await manager.startNode("a", "fake", null, {});

    await manager.disposeNode("a");

    expect(manager.getStatus("a")).toBe("not_started");
    expect(manager.getOutputBuffer("a")).toBe("");
  });

  test("isFreeToReceive is true only for idle and handoff_ready", async () => {
    manager = new NodeManager();
    expect(manager.isFreeToReceive("never-started")).toBe(false);

    await manager.startNode("a", "fake", null, {});
    expect(manager.isFreeToReceive("a")).toBe(true); // idle

    await manager.sendInput("a", "go\r");
    expect(manager.isFreeToReceive("a")).toBe(false); // working

    manager.markDone("a");
    expect(manager.isFreeToReceive("a")).toBe(true); // handoff_ready
  });

  test("an agent that requires a working directory defaults to the home directory when none is given", async () => {
    registerFakeAdapterType("fake-requires-dir", { workingDirectoryRequired: true });
    manager = new NodeManager();

    const resolved = await manager.startNode("a", "fake-requires-dir", null, {});

    expect(resolved).toBe(os.homedir());
    expect(manager.getStatus("a")).toBe("idle");
  });

  test("an agent with no working-directory requirement stays null when none is given", async () => {
    manager = new NodeManager(); // default "fake" type is workingDirectoryRequired: false

    const resolved = await manager.startNode("a", "fake", null, {});

    expect(resolved).toBeNull();
  });

  test("starting with a working directory that doesn't exist fails with a clear error", async () => {
    manager = new NodeManager();

    await expect(
      manager.startNode("a", "fake", "/definitely/does/not/exist", {}),
    ).rejects.toThrow(/does not exist/);
    expect(manager.getStatus("a")).toBe("error");
  });

  test("every completed turn records a cost entry — a real number when reported, unknown otherwise", async () => {
    manager = new NodeManager();
    let costUpdates = 0;
    const costPayloads: unknown[] = [];
    const broadcasts: string[] = [];
    manager.setBroadcast((channel, payload) => {
      broadcasts.push(channel);
      if (channel === "cost:updated") {
        costUpdates++;
        costPayloads.push(payload);
      }
    });

    await manager.startNode("a", "fake", null, {});
    await manager.sendInput("a", "go\r");
    fakes.get("a")!.usage = { dollarCost: 0.03, tokensOrUnits: 900 };
    manager.markDone("a");

    expect(costUpdates).toBe(1);
    expect(getCostSummary().currentRun).toEqual({ dollarTotal: 0.03, tokensOrUnits: 900, hasUnknown: false });
    // The event itself must carry the fresh summary — consumers read the
    // payload instead of each independently calling costs.getSummary().
    expect(costPayloads[0]).toMatchObject({ currentRun: { dollarTotal: 0.03, tokensOrUnits: 900, hasUnknown: false } });

    await manager.sendInput("a", "go again\r");
    fakes.get("a")!.usage = "unknown";
    manager.markDone("a");

    expect(costUpdates).toBe(2);
    expect(getCostSummary().currentRun).toEqual({ dollarTotal: 0.03, tokensOrUnits: 900, hasUnknown: true });
    expect(costPayloads[1]).toMatchObject({ currentRun: { dollarTotal: 0.03, tokensOrUnits: 900, hasUnknown: true } });
  });
});

describe("NodeManager — code changes", () => {
  function gitCmd(cwd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd }, (err) => (err ? reject(err) : resolve()));
    });
  }

  let repoDir: string;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-nodemanager-code-changes-"));
    await gitCmd(repoDir, ["init", "-q"]);
    await gitCmd(repoDir, ["config", "user.email", "test@example.com"]);
    await gitCmd(repoDir, ["config", "user.name", "Test"]);
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  // End-to-end: the before-snapshot at sendInput, the after-snapshot +
  // diff at completeTurn, and the persisted row are all wired correctly
  // through the real git module — the only thing faked here is the agent
  // itself (FakeAdapter never touches the filesystem, so the test writes
  // the file the "agent" produced, same as a real coding agent would).
  test(
    "a turn that changes a file in a real git working directory records a code change",
    async () => {
      manager = new NodeManager(20);
      await manager.startNode("a", "fake", repoDir, {});

      await manager.sendInput("a", "go\r");
      fs.writeFileSync(path.join(repoDir, "new-file.txt"), "written by the agent\n");
      fakes.get("a")!.emitOutput("done");
      manager.markDone("a");

      await wait(300); // the diff/persist step is fire-and-forget

      const runId = getOrCreateCurrentRun();
      const changes = listCodeChangeSummariesForRun(runId);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ nodeId: "a", filesChanged: 1, concurrentRisk: false });
    },
    10_000,
  );

  test(
    "a turn that changes nothing records no code change",
    async () => {
      manager = new NodeManager(20);
      await manager.startNode("a", "fake", repoDir, {});

      await manager.sendInput("a", "go\r");
      fakes.get("a")!.emitOutput("done");
      manager.markDone("a");

      await wait(300);

      expect(listCodeChangeSummariesForRun(getOrCreateCurrentRun())).toEqual([]);
    },
    10_000,
  );

  test(
    "a non-git working directory records no code change, never throws",
    async () => {
      const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-nodemanager-non-git-"));
      manager = new NodeManager(20);
      await manager.startNode("a", "fake", plainDir, {});

      await manager.sendInput("a", "go\r");
      fs.writeFileSync(path.join(plainDir, "file.txt"), "content");
      fakes.get("a")!.emitOutput("done");
      manager.markDone("a");

      await wait(300);

      expect(listCodeChangeSummariesForRun(getOrCreateCurrentRun())).toEqual([]);
      fs.rmSync(plainDir, { recursive: true, force: true });
    },
    10_000,
  );

  // The concurrency-safety requirement: a second node sharing the exact
  // same working directory, still "working" when the first one finishes,
  // must flag the first turn's diff as possibly-concurrent rather than
  // silently claiming sole ownership of whatever changed.
  test(
    "a turn is flagged concurrentRisk when another node sharing the same directory is still working",
    async () => {
      manager = new NodeManager(20);
      await manager.startNode("a", "fake", repoDir, {});
      await manager.startNode("b", "fake", repoDir, {});

      await manager.sendInput("a", "go\r");
      await manager.sendInput("b", "also go\r"); // b is still "working" when a finishes

      fs.writeFileSync(path.join(repoDir, "new-file.txt"), "written during the overlap\n");
      fakes.get("a")!.emitOutput("done");
      manager.markDone("a");

      await wait(300);

      const changes = listCodeChangeSummariesForRun(getOrCreateCurrentRun());
      expect(changes).toHaveLength(1);
      expect(changes[0].concurrentRisk).toBe(true);
    },
    10_000,
  );

  // Code Workspace v2's agent-node "View changes" affordance has nothing
  // else to learn about a fresh code change from — before this broadcast
  // existed, the renderer had no way to know one was ever recorded except
  // by manually opening Run History.
  test(
    "a real code change broadcasts codeChanges:recorded with the summary, matching what's actually stored",
    async () => {
      manager = new NodeManager(20);
      const broadcasts: Array<{ channel: string; payload: unknown }> = [];
      manager.setBroadcast((channel, payload) => broadcasts.push({ channel, payload }));

      await manager.startNode("a", "fake", repoDir, {});
      await manager.sendInput("a", "go\r");
      fs.writeFileSync(path.join(repoDir, "new-file.txt"), "written by the agent\n");
      fakes.get("a")!.emitOutput("done");
      manager.markDone("a");

      await wait(300);

      const recorded = broadcasts.filter((b) => b.channel === "codeChanges:recorded");
      expect(recorded).toHaveLength(1);
      const stored = listCodeChangeSummariesForRun(getOrCreateCurrentRun())[0];
      // Everything the broadcast can actually know (NodeManager only tracks
      // agentType, not the canvas-level name) matches the real stored row
      // exactly — nodeName is deliberately absent from the broadcast (see
      // captureCodeChange's own comment) and is filled in later, renderer-
      // side, only for the entry point that actually has it.
      const { nodeName: _storedNodeName, ...storedWithoutName } = stored;
      expect(recorded[0].payload).toEqual(storedWithoutName);
    },
    10_000,
  );

  test(
    "a zero-change turn never broadcasts codeChanges:recorded",
    async () => {
      manager = new NodeManager(20);
      const broadcasts: string[] = [];
      manager.setBroadcast((channel) => broadcasts.push(channel));

      await manager.startNode("a", "fake", repoDir, {});
      await manager.sendInput("a", "go\r");
      fakes.get("a")!.emitOutput("done");
      manager.markDone("a");

      await wait(300);

      expect(broadcasts).not.toContain("codeChanges:recorded");
    },
    10_000,
  );
});
