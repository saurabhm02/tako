import { describe, expect, test } from "bun:test";
import { serializeWorkflowContent } from "./types";
import type { ConnectionRecord, NodeRecord } from "../../shared/types";

function node(overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    id: "a",
    name: "Apollo",
    kind: "agent",
    agentType: "claude-code",
    adapterKind: "terminal",
    workingDirectory: "/tmp",
    config: {},
    position: { x: 10, y: 20 },
    ...overrides,
  };
}

function connection(overrides: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return { id: "c1", fromNodeId: "a", toNodeId: "b", autoApprove: false, ...overrides };
}

describe("serializeWorkflowContent — the whole unsaved-changes comparison", () => {
  test("identical content produces identical output", () => {
    expect(serializeWorkflowContent([node()], [connection()])).toBe(serializeWorkflowContent([node()], [connection()]));
  });

  test("a moved node (different position) produces different output", () => {
    const a = serializeWorkflowContent([node({ position: { x: 10, y: 20 } })], []);
    const b = serializeWorkflowContent([node({ position: { x: 11, y: 20 } })], []);
    expect(a).not.toBe(b);
  });

  test("a renamed node produces different output", () => {
    const a = serializeWorkflowContent([node({ name: "Apollo" })], []);
    const b = serializeWorkflowContent([node({ name: "Backend Reviewer" })], []);
    expect(a).not.toBe(b);
  });

  test("an added or removed node produces different output", () => {
    const a = serializeWorkflowContent([node({ id: "a" })], []);
    const b = serializeWorkflowContent([node({ id: "a" }), node({ id: "b" })], []);
    expect(a).not.toBe(b);
  });

  test("a new or removed connection produces different output", () => {
    const a = serializeWorkflowContent([], []);
    const b = serializeWorkflowContent([], [connection()]);
    expect(a).not.toBe(b);
  });

  test("a config/profile change produces different output", () => {
    const a = serializeWorkflowContent([node({ config: {} })], []);
    const b = serializeWorkflowContent([node({ config: { profileId: "saurabh" } })], []);
    expect(a).not.toBe(b);
  });

  test("the SAME config content compares equal regardless of key insertion order — a real risk after a JSON round trip through storage", () => {
    const a = serializeWorkflowContent([node({ config: { profileId: "x", model: "sonnet" } })], []);
    const b = serializeWorkflowContent([node({ config: { model: "sonnet", profileId: "x" } })], []);
    expect(a).toBe(b);
  });

  test("empty canvas serializes deterministically", () => {
    expect(serializeWorkflowContent([], [])).toBe(serializeWorkflowContent([], []));
  });
});
