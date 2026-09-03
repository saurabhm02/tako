import { describe, expect, test } from "bun:test";
import { parseLlmResponse } from "./parseActions";

describe("parseLlmResponse — actions — fails closed on anything not exactly a CanvasAction", () => {
  test("a well-formed array of actions parses", () => {
    const text = JSON.stringify([{ type: "stopNode", nodeRef: "Apollo" }, { type: "stopAll" }]);
    expect(parseLlmResponse(text)).toEqual({ kind: "actions", actions: [{ type: "stopNode", nodeRef: "Apollo" }, { type: "stopAll" }] });
  });

  test("an {actions: [...]} wrapper (json_object mode shape) also parses", () => {
    const text = JSON.stringify({ actions: [{ type: "stopAll" }] });
    expect(parseLlmResponse(text)).toEqual({ kind: "actions", actions: [{ type: "stopAll" }] });
  });

  test("a ```json fenced response is unwrapped", () => {
    const text = "```json\n" + JSON.stringify([{ type: "clearAll" }]) + "\n```";
    expect(parseLlmResponse(text)).toEqual({ kind: "actions", actions: [{ type: "clearAll" }] });
  });

  test("invalid JSON fails closed", () => {
    expect(parseLlmResponse("not json at all")).toBeNull();
  });

  test("an unknown action type never passes through", () => {
    expect(parseLlmResponse(JSON.stringify([{ type: "deleteEverything", nodeRef: "Apollo" }]))).toBeNull();
  });

  test("a known type missing a required field fails closed", () => {
    expect(parseLlmResponse(JSON.stringify([{ type: "connect", from: "Apollo" }]))).toBeNull();
  });

  test("one bad element fails the whole batch, not just that element", () => {
    const text = JSON.stringify([{ type: "stopAll" }, { type: "notARealAction" }]);
    expect(parseLlmResponse(text)).toBeNull();
  });

  test("an empty array fails closed (nothing to run is not a valid result)", () => {
    expect(parseLlmResponse(JSON.stringify([]))).toBeNull();
  });

  test("a plain object with neither actions nor query fails closed", () => {
    expect(parseLlmResponse(JSON.stringify({ type: "stopAll" }))).toBeNull();
  });

  test("a run-away action count is rejected", () => {
    const actions = Array.from({ length: 21 }, () => ({ type: "stopAll" }));
    expect(parseLlmResponse(JSON.stringify(actions))).toBeNull();
  });

  test("extra unexpected fields on a valid action are stripped, not passed through", () => {
    const text = JSON.stringify([{ type: "stopNode", nodeRef: "Apollo", evilShellCommand: "rm -rf /" }]);
    const result = parseLlmResponse(text);
    expect(result).toEqual({ kind: "actions", actions: [{ type: "stopNode", nodeRef: "Apollo" }] });
    expect(result?.kind === "actions" && Object.keys(result.actions[0])).toEqual(["type", "nodeRef"]);
  });

  test("optional field (addNode.name) is preserved when present, absent when not", () => {
    expect(parseLlmResponse(JSON.stringify([{ type: "addNode", agentType: "pi", name: "Researcher" }]))).toEqual({
      kind: "actions",
      actions: [{ type: "addNode", agentType: "pi", name: "Researcher" }],
    });
    expect(parseLlmResponse(JSON.stringify([{ type: "addNode", agentType: "pi" }]))).toEqual({
      kind: "actions",
      actions: [{ type: "addNode", agentType: "pi" }],
    });
  });
});

describe("parseLlmResponse — read-only queries — same fail-closed discipline", () => {
  test("a well-formed listByStatus query parses", () => {
    expect(parseLlmResponse(JSON.stringify({ query: { type: "listByStatus", bucket: "running" } }))).toEqual({
      kind: "query",
      query: { type: "listByStatus", bucket: "running" },
    });
  });

  test("every known bucket is accepted", () => {
    const buckets = ["running", "waiting", "error", "completed"] as const;
    for (const bucket of buckets) {
      expect(parseLlmResponse(JSON.stringify({ query: { type: "listByStatus", bucket } }))).toEqual({
        kind: "query",
        query: { type: "listByStatus", bucket },
      });
    }
  });

  test("a countAgents query parses", () => {
    expect(parseLlmResponse(JSON.stringify({ query: { type: "countAgents" } }))).toEqual({ kind: "query", query: { type: "countAgents" } });
  });

  test("an unknown bucket fails closed, never invents a bucket", () => {
    expect(parseLlmResponse(JSON.stringify({ query: { type: "listByStatus", bucket: "exploding" } }))).toBeNull();
  });

  test("an unknown query type fails closed", () => {
    expect(parseLlmResponse(JSON.stringify({ query: { type: "deleteEverything" } }))).toBeNull();
  });

  test("a malformed query key never falls through to being parsed as an actions array", () => {
    expect(parseLlmResponse(JSON.stringify({ query: "running", actions: [{ type: "stopAll" }] }))).toBeNull();
  });
});

describe("parseLlmResponse — the two new Canvas Command Interaction v2 actions", () => {
  test("a well-formed changeAgentType parses", () => {
    const text = JSON.stringify([{ type: "changeAgentType", nodeRef: "Apollo", agentType: "pi" }]);
    expect(parseLlmResponse(text)).toEqual({ kind: "actions", actions: [{ type: "changeAgentType", nodeRef: "Apollo", agentType: "pi" }] });
  });

  test("changeAgentType missing agentType fails closed", () => {
    expect(parseLlmResponse(JSON.stringify([{ type: "changeAgentType", nodeRef: "Apollo" }]))).toBeNull();
  });

  test("a well-formed duplicateNode parses, with and without an explicit name", () => {
    expect(parseLlmResponse(JSON.stringify([{ type: "duplicateNode", nodeRef: "Apollo", name: "Tester" }]))).toEqual({
      kind: "actions",
      actions: [{ type: "duplicateNode", nodeRef: "Apollo", name: "Tester" }],
    });
    expect(parseLlmResponse(JSON.stringify([{ type: "duplicateNode", nodeRef: "Apollo" }]))).toEqual({
      kind: "actions",
      actions: [{ type: "duplicateNode", nodeRef: "Apollo" }],
    });
  });

  test("duplicateNode missing nodeRef fails closed", () => {
    expect(parseLlmResponse(JSON.stringify([{ type: "duplicateNode", name: "Tester" }]))).toBeNull();
  });

  test("extra unexpected fields on either new action are stripped, not passed through", () => {
    const text = JSON.stringify([{ type: "changeAgentType", nodeRef: "Apollo", agentType: "pi", nodeId: "real-uuid-leak-attempt" }]);
    const result = parseLlmResponse(text);
    expect(result).toEqual({ kind: "actions", actions: [{ type: "changeAgentType", nodeRef: "Apollo", agentType: "pi" }] });
  });
});
