import { describe, expect, test } from "bun:test";
import { ConnectionGraph } from "./ConnectionGraph";

describe("ConnectionGraph", () => {
  test("getOutgoing only returns connections isolation-scoped to the given node", () => {
    const graph = new ConnectionGraph();
    graph.upsert({ id: "c1", fromNodeId: "a", toNodeId: "b", autoApprove: false });
    graph.upsert({ id: "c2", fromNodeId: "a", toNodeId: "c", autoApprove: false });
    graph.upsert({ id: "c3", fromNodeId: "b", toNodeId: "c", autoApprove: false });

    const fromA = graph.getOutgoing("a");
    expect(fromA.map((c) => c.id).sort()).toEqual(["c1", "c2"]);

    // Node "c" has no outgoing connections — nothing routes from it.
    expect(graph.getOutgoing("c")).toEqual([]);
  });

  test("setAutoApprove updates only the targeted connection", () => {
    const graph = new ConnectionGraph();
    graph.upsert({ id: "c1", fromNodeId: "a", toNodeId: "b", autoApprove: false });
    graph.upsert({ id: "c2", fromNodeId: "a", toNodeId: "c", autoApprove: false });

    graph.setAutoApprove("c1", true);

    const [c1, c2] = [graph.getOutgoing("a").find((c) => c.id === "c1")!, graph.getOutgoing("a").find((c) => c.id === "c2")!];
    expect(c1.autoApprove).toBe(true);
    expect(c2.autoApprove).toBe(false);
  });

  test("removeForNode drops every connection touching that node, either direction", () => {
    const graph = new ConnectionGraph();
    graph.upsert({ id: "c1", fromNodeId: "a", toNodeId: "b", autoApprove: false });
    graph.upsert({ id: "c2", fromNodeId: "b", toNodeId: "a", autoApprove: false });
    graph.upsert({ id: "c3", fromNodeId: "x", toNodeId: "y", autoApprove: false });

    graph.removeForNode("a");

    expect(graph.getOutgoing("a")).toEqual([]);
    expect(graph.getOutgoing("b")).toEqual([]);
    expect(graph.getOutgoing("x").map((c) => c.id)).toEqual(["c3"]);
  });

  test("replaceAll clears prior connections before loading the new set", () => {
    const graph = new ConnectionGraph();
    graph.upsert({ id: "stale", fromNodeId: "a", toNodeId: "b", autoApprove: false });

    graph.replaceAll([{ id: "fresh", fromNodeId: "a", toNodeId: "c", autoApprove: true }]);

    expect(graph.getOutgoing("a").map((c) => c.id)).toEqual(["fresh"]);
  });
});
