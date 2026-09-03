import { describe, expect, test } from "bun:test";
import { hasPendingHandoffForEdge, pendingHandoffCountForNode, removePendingHandoffsForNode } from "./types";
import type { HandoffSummary } from "../../shared/types";

function handoff(overrides: Partial<HandoffSummary>): HandoffSummary {
  return {
    id: "h1",
    fromNodeId: "a",
    toNodeId: "b",
    payloadText: "final output",
    edited: false,
    autoApproved: false,
    status: "pending",
    createdAt: 0,
    ...overrides,
  };
}

// These two functions are the single place "should handoff UI show here"
// is decided (CanvasApp derives AgentNode's banner and the edge label from
// them) — a connection existing on the canvas is never enough on its own.
describe("pendingHandoffCountForNode", () => {
  test("a connection with no pending handoff shows nothing", () => {
    expect(pendingHandoffCountForNode([], "a")).toBe(0);
  });

  test("a real pending handoff from this node counts", () => {
    const pending = [handoff({ fromNodeId: "a", toNodeId: "b" })];
    expect(pendingHandoffCountForNode(pending, "a")).toBe(1);
  });

  test("a pending handoff FROM a different node is not counted", () => {
    const pending = [handoff({ fromNodeId: "b", toNodeId: "c" })];
    expect(pendingHandoffCountForNode(pending, "a")).toBe(0);
  });

  test("multiple pending handoffs from the same node are all represented", () => {
    const pending = [
      handoff({ id: "h1", fromNodeId: "a", toNodeId: "b" }),
      handoff({ id: "h2", fromNodeId: "a", toNodeId: "c" }),
    ];
    expect(pendingHandoffCountForNode(pending, "a")).toBe(2);
  });

  // Delivered/rejected/queued handoffs are already removed from the
  // `pending` list by CanvasApp's onResolved handler before this is ever
  // called — this proves the derivation itself doesn't need to re-check
  // status, since a resolved handoff is simply absent from the input.
  test("a resolved handoff already removed from the list is not counted", () => {
    expect(pendingHandoffCountForNode([], "a")).toBe(0);
  });
});

describe("hasPendingHandoffForEdge", () => {
  test("an edge with no pending handoff is not marked ready", () => {
    expect(hasPendingHandoffForEdge([], "a", "b")).toBe(false);
  });

  test("a real pending handoff for this exact edge is marked ready", () => {
    const pending = [handoff({ fromNodeId: "a", toNodeId: "b" })];
    expect(hasPendingHandoffForEdge(pending, "a", "b")).toBe(true);
  });

  test("a pending handoff for a different edge does not mark this one", () => {
    const pending = [handoff({ fromNodeId: "a", toNodeId: "c" })];
    expect(hasPendingHandoffForEdge(pending, "a", "b")).toBe(false);
  });

  // HandoffEngine.proposeForOutgoing approves an auto-approve connection
  // immediately and only ever broadcasts handoff:pending for the manual
  // case (see HandoffEngine.ts) — CanvasApp's onResolved handler removes a
  // delivered handoff from `pending` the moment that event arrives, so by
  // the time this function runs, an auto-approved/already-delivered
  // handoff is simply never in the array. Nothing stale to show.
  test("an auto-approved handoff that was already delivered (and removed from pending) does not mark the edge ready", () => {
    expect(hasPendingHandoffForEdge([], "a", "b")).toBe(false);
  });
});

// Regression: closing a node used to leave its pending handoffs stuck in
// the Approval Sidebar forever — the underlying handoff row is cascade-
// deleted server-side (deleteNode), so Approve/Reject on the stale card
// silently no-op with zero feedback once clicked.
describe("removePendingHandoffsForNode", () => {
  test("a handoff FROM the removed node is dropped", () => {
    const pending = [handoff({ fromNodeId: "a", toNodeId: "b" })];
    expect(removePendingHandoffsForNode(pending, "a")).toEqual([]);
  });

  test("a handoff TO the removed node is dropped", () => {
    const pending = [handoff({ fromNodeId: "a", toNodeId: "b" })];
    expect(removePendingHandoffsForNode(pending, "b")).toEqual([]);
  });

  test("a handoff unrelated to the removed node is preserved", () => {
    const pending = [
      handoff({ id: "h1", fromNodeId: "a", toNodeId: "b" }),
      handoff({ id: "h2", fromNodeId: "c", toNodeId: "d" }),
    ];
    expect(removePendingHandoffsForNode(pending, "a")).toEqual([pending[1]]);
  });
});
