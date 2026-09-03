import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NodeManager } from "../node-manager/NodeManager";
import { ConnectionGraph } from "../graph/ConnectionGraph";
import { HandoffEngine } from "./HandoffEngine";
import { closeDatabaseForTests, initDatabase } from "../store/db";
import { resetCurrentRunForTests } from "../store/runsRepo";
import { ensureNodeExists, ensureWorkflowExists, upsertConnection } from "../store/workflowsRepo";
import { registerFakeAdapterType, type FakeAdapter } from "../../../tests/fakeAdapter";
import { DEFAULT_WORKFLOW_ID, type HandoffSummary } from "../../shared/types";

let fakes: Map<string, FakeAdapter>;
let manager: NodeManager;
let graph: ConnectionGraph;
let broadcasts: Array<{ channel: string; payload: unknown }>;

// Mirrors what the real connections:create IPC handler does: update the
// live graph AND the real connections row (handoffs.connection_id has a
// foreign key against it).
function connect(fromNodeId: string, toNodeId: string, autoApprove = false) {
  const id = `${fromNodeId}->${toNodeId}`;
  graph.upsert({ id, fromNodeId, toNodeId, autoApprove });
  upsertConnection({ id, workflowId: DEFAULT_WORKFLOW_ID, fromNodeId, toNodeId, autoApprove });
  return id;
}

// A Compare Node is never started (no adapter), so it needs its own nodes
// row created directly — startNode's own insurance insert is what gives
// "a"/"b" theirs in every other test here.
function makeCompareNode(id: string) {
  ensureWorkflowExists(DEFAULT_WORKFLOW_ID, "My Workflow");
  ensureNodeExists({
    id,
    workflowId: DEFAULT_WORKFLOW_ID,
    name: id,
    kind: "compare",
    agentType: "compare",
    adapterKind: "terminal",
    workingDirectory: null,
    config: {},
    position: { x: 0, y: 0 },
  });
}

function pendingFor(fromNodeId: string): HandoffSummary {
  const events = broadcasts.filter((b) => b.channel === "handoff:pending").map((b) => b.payload as HandoffSummary);
  const handoff = events.find((h) => h.fromNodeId === fromNodeId);
  if (!handoff) throw new Error(`no pending handoff found from ${fromNodeId}`);
  return handoff;
}

function resolvedEvents(): HandoffSummary[] {
  return broadcasts.filter((b) => b.channel === "handoff:resolved").map((b) => b.payload as HandoffSummary);
}

// One engine per test, created explicitly (not in beforeEach) so a test
// that wants a non-default hop limit doesn't end up with two engines both
// reacting to the same NodeManager events.
function makeEngine(hopLimit?: number): HandoffEngine {
  return new HandoffEngine(manager, graph, (channel, payload) => broadcasts.push({ channel, payload }), hopLimit);
}

beforeEach(() => {
  closeDatabaseForTests();
  initDatabase(":memory:");
  resetCurrentRunForTests();
  fakes = registerFakeAdapterType("fake");
  manager = new NodeManager();
  graph = new ConnectionGraph();
  broadcasts = [];
});

// Every started node arms a real idle-timeout timer (CompletionDetector).
// Left running past the end of a test, it fires later against whatever
// database a different test file has since swapped in.
afterEach(async () => {
  await manager.shutdownAll();
});

describe("HandoffEngine — full flow", () => {
  test("A's finished output becomes an editable pending handoff, and approving delivers it into B's live session", async () => {
    const engine = makeEngine();
    await manager.startNode("a", "fake", null, {});
    await manager.startNode("b", "fake", null, {});
    connect("a", "b");

    await manager.sendInput("a", "what is 2+2?\r");
    fakes.get("a")!.emitOutput("4");
    manager.markDone("a");

    const handoff = pendingFor("a");
    expect(handoff.toNodeId).toBe("b");
    expect(handoff.payloadText).toBe("4");
    expect(handoff.status).toBe("pending");

    engine.editPayload(handoff.id, "please echo: 4");
    engine.approve(handoff.id);

    expect(fakes.get("b")!.sent).toEqual(["please echo: 4\r"]);
    const resolved = resolvedEvents().find((h) => h.id === handoff.id)!;
    expect(resolved.status).toBe("delivered");
    expect(resolved.edited).toBe(true);
  });
});

describe("HandoffEngine — isolation", () => {
  test("a node with no connection to A never receives anything, even when A hands off to B", async () => {
    const engine = makeEngine();
    await manager.startNode("a", "fake", null, {});
    await manager.startNode("b", "fake", null, {});
    await manager.startNode("c", "fake", null, {}); // deliberately unconnected
    connect("a", "b");

    await manager.sendInput("a", "secret\r");
    fakes.get("a")!.emitOutput("SECRET-42");
    manager.markDone("a");
    engine.approve(pendingFor("a").id);

    expect(fakes.get("b")!.sent).toEqual(["SECRET-42\r"]);
    expect(fakes.get("c")!.sent).toEqual([]);
  });
});

describe("HandoffEngine — rejection", () => {
  test("rejecting discards the handoff without delivering, and leaves A's own output untouched", async () => {
    const engine = makeEngine();
    await manager.startNode("a", "fake", null, {});
    await manager.startNode("b", "fake", null, {});
    connect("a", "b");

    await manager.sendInput("a", "go\r");
    fakes.get("a")!.emitOutput("REJECT-ME");
    manager.markDone("a");

    const handoff = pendingFor("a");
    engine.reject(handoff.id);

    expect(fakes.get("b")!.sent).toEqual([]);
    expect(manager.getOutputBuffer("a")).toContain("REJECT-ME"); // HA2
    expect(resolvedEvents().find((h) => h.id === handoff.id)!.status).toBe("rejected");
  });
});

describe("HandoffEngine — queueing", () => {
  test("an approved handoff to a busy node queues, then auto-delivers once that node frees up", async () => {
    const engine = makeEngine();
    await manager.startNode("a", "fake", null, {});
    await manager.startNode("b", "fake", null, {});
    connect("a", "b");

    // Make B busy first.
    await manager.sendInput("b", "counting task\r");
    expect(manager.getStatus("b")).toBe("working");

    await manager.sendInput("a", "go\r");
    fakes.get("a")!.emitOutput("QUEUED-PAYLOAD");
    manager.markDone("a");
    const handoff = pendingFor("a");

    engine.approve(handoff.id);

    // Still busy — must not have been delivered yet.
    expect(fakes.get("b")!.sent).toEqual(["counting task\r"]);
    expect(resolvedEvents().find((h) => h.id === handoff.id)!.status).toBe("queued");

    // B finishes its own turn — the queued handoff should drain automatically.
    manager.markDone("b");

    expect(fakes.get("b")!.sent).toEqual(["counting task\r", "QUEUED-PAYLOAD\r"]);
    expect(resolvedEvents().filter((h) => h.id === handoff.id).at(-1)!.status).toBe("delivered");
  });
});

describe("HandoffEngine — compare fan-out", () => {
  // A Compare Node has no adapter and is never registered with NodeManager
  // at all — it calls proposeForOutgoing directly with whatever the user
  // typed, instead of waiting for a completion signal that will never come.
  test("proposeForOutgoing fans one payload out to every outgoing connection, unregistered source node included", async () => {
    const engine = makeEngine();
    await manager.startNode("a", "fake", null, {});
    await manager.startNode("b", "fake", null, {});
    makeCompareNode("compare-1");
    connect("compare-1", "a");
    connect("compare-1", "b");

    engine.proposeForOutgoing("compare-1", "what is 2+2?");

    const forA = pendingFor("compare-1");
    const forB = broadcasts
      .filter((e) => e.channel === "handoff:pending")
      .map((e) => e.payload as HandoffSummary)
      .find((h) => h.toNodeId === "b")!;

    expect(forA.payloadText).toBe("what is 2+2?");
    expect(forB.payloadText).toBe("what is 2+2?");

    engine.approve(forA.id);
    engine.approve(forB.id);

    expect(fakes.get("a")!.sent).toEqual(["what is 2+2?\r"]);
    expect(fakes.get("b")!.sent).toEqual(["what is 2+2?\r"]);
  });

  test("an empty prompt fans out to nothing", async () => {
    const engine = makeEngine();
    await manager.startNode("a", "fake", null, {});
    makeCompareNode("compare-1");
    connect("compare-1", "a");

    engine.proposeForOutgoing("compare-1", "   ");

    expect(broadcasts.filter((e) => e.channel === "handoff:pending")).toEqual([]);
  });
});

describe("HandoffEngine — hop limit", () => {
  test("auto-approve stops working once the run's hop limit is reached, and the run is flagged", async () => {
    const engine = makeEngine(2);
    await manager.startNode("a", "fake", null, {});
    await manager.startNode("b", "fake", null, {});
    connect("a", "b", true); // auto-approve
    void engine; // engine drives everything through NodeManager events below

    async function round(n: number) {
      await manager.sendInput("a", `round${n}\r`);
      fakes.get("a")!.emitOutput(`round${n}`);
      manager.markDone("a");
    }

    await round(1);
    await round(2);
    await round(3);

    const resolved = resolvedEvents();
    expect(resolved.filter((h) => h.status === "delivered" || h.status === "queued").length).toBe(2);

    // The third round should still be sitting pending, not auto-approved.
    const stillPending = pendingFor("a");
    expect(stillPending.payloadText).toBe("round3");

    const hopLimitEvents = broadcasts.filter((b) => b.channel === "run:hopLimitReached");
    expect(hopLimitEvents.length).toBe(1);
  });
});
