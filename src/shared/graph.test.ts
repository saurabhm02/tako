import { describe, expect, test } from "bun:test";
import { cycleEdgeKeys, findCycles } from "./graph";

describe("findCycles", () => {
  test("no edges, no cycles", () => {
    expect(findCycles([])).toEqual([]);
  });

  test("a simple chain has no cycle", () => {
    const edges = [{ from: "a", to: "b" }, { from: "b", to: "c" }];
    expect(findCycles(edges)).toEqual([]);
  });

  test("a two-way pair (A->B and B->A) is a cycle", () => {
    const edges = [{ from: "a", to: "b" }, { from: "b", to: "a" }];
    const cycles = findCycles(edges);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(["a", "b"]));
  });

  test("a longer loop (A->B->C->A) is detected as one cycle", () => {
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ];
    const cycles = findCycles(edges);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(["a", "b", "c"]));
  });

  test("a cycle plus an unrelated branch only reports the real cycle", () => {
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "a", to: "c" }, // c is downstream, not part of any loop
    ];
    const cycles = findCycles(edges);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(["a", "b"]));
  });

  test("the same cycle is reported once regardless of which node the DFS reaches first", () => {
    // Two entry points (x and y) both lead into the same a<->b<->c loop.
    const edges = [
      { from: "x", to: "a" },
      { from: "y", to: "b" },
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ];
    expect(findCycles(edges)).toHaveLength(1);
  });

  test("a self-loop (A->A) is a cycle of one node", () => {
    const edges = [{ from: "a", to: "a" }];
    const cycles = findCycles(edges);
    expect(cycles).toEqual([["a"]]);
  });
});

describe("cycleEdgeKeys", () => {
  test("only the looping edges are flagged, not the rest of the graph", () => {
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "a", to: "c" },
    ];
    const keys = cycleEdgeKeys(edges);
    expect(keys.has("a>b")).toBe(true);
    expect(keys.has("b>a")).toBe(true);
    expect(keys.has("a>c")).toBe(false);
  });

  test("empty when there's no cycle at all", () => {
    expect(cycleEdgeKeys([{ from: "a", to: "b" }]).size).toBe(0);
  });
});
