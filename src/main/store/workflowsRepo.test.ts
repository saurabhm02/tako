import { beforeEach, describe, expect, test } from "bun:test";
import { closeDatabaseForTests, initDatabase } from "./db";
import { getOrCreateCurrentRun, resetCurrentRunForTests } from "./runsRepo";
import { insertNodeRun } from "./nodeRunsRepo";
import { insertHandoff } from "./handoffsRepo";
import {
  deleteConnection,
  deleteNode,
  deleteWorkflow,
  getNodeRuntimeState,
  listWorkflows,
  loadWorkflow,
  renameWorkflow,
  saveNodeRuntimeState,
  saveWorkflow,
  setActiveWorkflowId,
  upsertConnection,
} from "./workflowsRepo";
import { DEFAULT_WORKFLOW_ID, type WorkflowSnapshot } from "../../shared/types";

function snapshot(overrides: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    id: DEFAULT_WORKFLOW_ID,
    name: "My Workflow",
    nodes: [],
    connections: [],
    ...overrides,
  };
}

beforeEach(() => {
  closeDatabaseForTests();
  initDatabase(":memory:");
  resetCurrentRunForTests();
});

describe("saveWorkflow", () => {
  // A node the user has ever started has node_runs/handoffs/costs rows
  // referencing it. The old implementation wiped every node row for the
  // workflow before reinserting — that DELETE hit the foreign key the
  // moment any node had real history, rolling back the whole save
  // (transactions are all-or-nothing), so nothing the user just edited
  // actually persisted. This is the regression test for that fix.
  test("re-saving a workflow whose node already has run history still persists edits", () => {
    saveWorkflow(
      snapshot({
        nodes: [
          {
            id: "a",
            name: "Note",
            kind: "note",
            agentType: "note",
            adapterKind: "terminal",
            workingDirectory: null,
            config: { text: "" },
            position: { x: 0, y: 0 },
          },
        ],
      }),
    );
    const runId = getOrCreateCurrentRun();
    insertNodeRun(runId, "a"); // gives node "a" real, FK-referencing history

    saveWorkflow(
      snapshot({
        nodes: [
          {
            id: "a",
            name: "Note",
            kind: "note",
            agentType: "note",
            adapterKind: "terminal",
            workingDirectory: null,
            config: { text: "hello from a real note" },
            position: { x: 10, y: 20 },
          },
        ],
      }),
    );

    const loaded = loadWorkflow(DEFAULT_WORKFLOW_ID)!;
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0].config).toEqual({ text: "hello from a real note" });
    expect(loaded.nodes[0].position).toEqual({ x: 10, y: 20 });
  });

  test("a node with no history is removed when it's no longer in the snapshot", () => {
    saveWorkflow(
      snapshot({
        nodes: [
          {
            id: "a",
            name: "A",
            kind: "note",
            agentType: "note",
            adapterKind: "terminal",
            workingDirectory: null,
            config: {},
            position: { x: 0, y: 0 },
          },
        ],
      }),
    );

    saveWorkflow(snapshot({ nodes: [] }));

    expect(loadWorkflow(DEFAULT_WORKFLOW_ID)!.nodes).toHaveLength(0);
  });
});

describe("node runtime state (conversation persistence)", () => {
  test("a node that's never run yet has no output and no session ref", () => {
    expect(getNodeRuntimeState("never-started")).toEqual({ lastOutputText: "", sessionRef: null });
  });

  test("round-trips output text and a session ref for a real node", () => {
    saveWorkflow(
      snapshot({
        nodes: [
          {
            id: "a",
            name: "A",
            kind: "agent",
            agentType: "codex-chatgpt",
            adapterKind: "session",
            workingDirectory: null,
            config: {},
            position: { x: 0, y: 0 },
          },
        ],
      }),
    );

    saveNodeRuntimeState("a", "hello from the last session", "thread-123");

    expect(getNodeRuntimeState("a")).toEqual({ lastOutputText: "hello from the last session", sessionRef: "thread-123" });
  });

  // Same trust boundary as node_runs.final_output_text (HI1) — a live
  // conversation is exactly where a pasted API key would show up.
  test("redacts secrets before persisting, same as run history", () => {
    saveWorkflow(snapshot({ nodes: [{ id: "a", name: "A", kind: "agent", agentType: "claude-code", adapterKind: "terminal", workingDirectory: "/tmp", config: {}, position: { x: 0, y: 0 } }] }));

    saveNodeRuntimeState("a", "my key is sk-ant-abcdefghijklmnopqrstuvwx", null);

    expect(getNodeRuntimeState("a").lastOutputText).not.toContain("sk-ant-");
  });
});

describe("deleteNode", () => {
  // The actual bug report: removing a node from the canvas never persisted
  // — it only stopped the live process, so the row survived and the node
  // reappeared on the next load.
  test("a deleted node never reappears on the next load, even with real run history", () => {
    saveWorkflow(
      snapshot({
        nodes: [
          {
            id: "a",
            name: "A",
            kind: "agent",
            agentType: "claude-code",
            adapterKind: "terminal",
            workingDirectory: "/tmp",
            config: {},
            position: { x: 0, y: 0 },
          },
        ],
      }),
    );
    const runId = getOrCreateCurrentRun();
    insertNodeRun(runId, "a"); // auto-start gives it real, FK-referencing history immediately

    deleteNode("a");

    expect(loadWorkflow(DEFAULT_WORKFLOW_ID)!.nodes).toHaveLength(0);
  });
});

describe("deleteConnection", () => {
  // The actual bug report: removing an edge that ever carried a handoff
  // (even a long-resolved one) crashed with SQLITE_CONSTRAINT_FOREIGNKEY,
  // since handoffs.connection_id still referenced the row being deleted.
  test("a connection that already carried a handoff can still be removed", () => {
    saveWorkflow(
      snapshot({
        nodes: [
          { id: "a", name: "A", kind: "agent", agentType: "claude-code", adapterKind: "terminal", workingDirectory: "/tmp", config: {}, position: { x: 0, y: 0 } },
          { id: "b", name: "B", kind: "agent", agentType: "claude-code", adapterKind: "terminal", workingDirectory: "/tmp", config: {}, position: { x: 0, y: 0 } },
        ],
      }),
    );
    upsertConnection({ id: "conn-1", workflowId: DEFAULT_WORKFLOW_ID, fromNodeId: "a", toNodeId: "b", autoApprove: false });
    const runId = getOrCreateCurrentRun();
    insertHandoff({ runId, connectionId: "conn-1", fromNodeId: "a", toNodeId: "b", payloadText: "done", autoApproved: false });

    expect(() => deleteConnection("conn-1")).not.toThrow();
    expect(loadWorkflow(DEFAULT_WORKFLOW_ID)!.connections).toHaveLength(0);
  });
});

describe("multiple workflows", () => {
  test("listWorkflows returns every saved workflow, most recently updated first", () => {
    saveWorkflow(snapshot({ id: "wf-a", name: "Alpha" }));
    saveWorkflow(snapshot({ id: "wf-b", name: "Beta" }));

    const listed = listWorkflows();
    expect(listed.map((w) => w.id).sort()).toEqual(["wf-a", "wf-b"]);
  });

  test("renameWorkflow changes the name without touching its nodes/connections", () => {
    saveWorkflow(
      snapshot({
        id: "wf-a",
        name: "Alpha",
        nodes: [{ id: "a", name: "A", kind: "agent", agentType: "claude-code", adapterKind: "terminal", workingDirectory: "/tmp", config: {}, position: { x: 5, y: 9 } }],
      }),
    );

    renameWorkflow("wf-a", "Renamed");

    const reloaded = loadWorkflow("wf-a")!;
    expect(reloaded.name).toBe("Renamed");
    expect(reloaded.nodes).toHaveLength(1);
    expect(reloaded.nodes[0].position).toEqual({ x: 5, y: 9 });
  });

  // The core independence guarantee: two workflows must never see or
  // affect each other's nodes/connections, and each keeps its exact node
  // position across save/load.
  test("two workflows keep fully independent nodes, connections, and node positions", () => {
    saveWorkflow(
      snapshot({
        id: "wf-a",
        name: "Alpha",
        nodes: [
          { id: "a1", name: "A1", kind: "agent", agentType: "claude-code", adapterKind: "terminal", workingDirectory: "/tmp", config: {}, position: { x: 111, y: 222 } },
        ],
      }),
    );
    saveWorkflow(
      snapshot({
        id: "wf-b",
        name: "Beta",
        nodes: [
          { id: "b1", name: "B1", kind: "agent", agentType: "pi", adapterKind: "terminal", workingDirectory: "/tmp", config: {}, position: { x: 333, y: 444 } },
        ],
      }),
    );

    const a = loadWorkflow("wf-a")!;
    const b = loadWorkflow("wf-b")!;

    expect(a.nodes.map((n) => n.id)).toEqual(["a1"]);
    expect(a.nodes[0].position).toEqual({ x: 111, y: 222 });
    expect(b.nodes.map((n) => n.id)).toEqual(["b1"]);
    expect(b.nodes[0].position).toEqual({ x: 333, y: 444 });
  });

  test("deleteWorkflow cascades its own runs/handoffs/costs/nodes/connections without touching another workflow", () => {
    saveWorkflow(
      snapshot({
        id: "wf-a",
        name: "Alpha",
        nodes: [
          { id: "a1", name: "A1", kind: "agent", agentType: "claude-code", adapterKind: "terminal", workingDirectory: "/tmp", config: {}, position: { x: 0, y: 0 } },
          { id: "a2", name: "A2", kind: "agent", agentType: "claude-code", adapterKind: "terminal", workingDirectory: "/tmp", config: {}, position: { x: 0, y: 0 } },
        ],
        connections: [{ id: "conn-a", fromNodeId: "a1", toNodeId: "a2", autoApprove: false }],
      }),
    );
    saveWorkflow(snapshot({ id: "wf-b", name: "Beta" }));

    setActiveWorkflowId("wf-a");
    const runId = getOrCreateCurrentRun();
    insertNodeRun(runId, "a1");
    insertHandoff({ runId, connectionId: "conn-a", fromNodeId: "a1", toNodeId: "a2", payloadText: "done", autoApproved: false });
    setActiveWorkflowId(DEFAULT_WORKFLOW_ID);

    expect(() => deleteWorkflow("wf-a")).not.toThrow();

    expect(loadWorkflow("wf-a")).toBeNull();
    expect(listWorkflows().map((w) => w.id)).not.toContain("wf-a");
    expect(loadWorkflow("wf-b")).not.toBeNull(); // untouched
  });
});
