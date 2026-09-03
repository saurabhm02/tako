import { describe, expect, test } from "bun:test";
import { duplicateSnapshotWithFreshIds } from "./types";
import type { ConnectionRecord, NodeRecord } from "../../shared/types";

function node(id: string): NodeRecord {
  return {
    id,
    name: id,
    kind: "agent",
    agentType: "claude-code",
    adapterKind: "terminal",
    workingDirectory: "/tmp",
    config: {},
    position: { x: 0, y: 0 },
  };
}

function connection(id: string, fromNodeId: string, toNodeId: string): ConnectionRecord {
  return { id, fromNodeId, toNodeId, autoApprove: false };
}

describe("duplicateSnapshotWithFreshIds", () => {
  // The core regression: saveWorkflow's upsert never reassigns an existing
  // row's workflow_id, so reusing the same node/connection ids for a
  // duplicate would silently save nothing new — every id must be fresh.
  test("every node and connection gets a new id, never reusing the original", () => {
    const { nodes, connections } = duplicateSnapshotWithFreshIds(
      [node("a"), node("b")],
      [connection("c1", "a", "b")],
    );

    expect(nodes.map((n) => n.id)).not.toContain("a");
    expect(nodes.map((n) => n.id)).not.toContain("b");
    expect(connections[0].id).not.toBe("c1");
  });

  test("a connection's from/to are remapped to the SAME new ids as their nodes", () => {
    const { nodes, connections } = duplicateSnapshotWithFreshIds(
      [node("a"), node("b")],
      [connection("c1", "a", "b")],
    );

    const newIdForA = nodes.find((n) => n.name === "a")!.id;
    const newIdForB = nodes.find((n) => n.name === "b")!.id;
    expect(connections[0].fromNodeId).toBe(newIdForA);
    expect(connections[0].toNodeId).toBe(newIdForB);
  });

  test("every other field is preserved as-is", () => {
    const { nodes } = duplicateSnapshotWithFreshIds([node("a")], []);
    expect(nodes[0]).toMatchObject({
      name: "a",
      agentType: "claude-code",
      workingDirectory: "/tmp",
      position: { x: 0, y: 0 },
    });
  });
});
