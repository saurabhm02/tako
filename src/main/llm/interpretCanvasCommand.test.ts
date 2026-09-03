import { describe, expect, test } from "bun:test";
import { interpretWithProvider } from "./interpretCanvasCommand";
import type { LlmProvider } from "./provider";
import type { CanvasCommandContext } from "../../shared/types";

const emptyContext: CanvasCommandContext = { nodes: [], edges: [], installedAgents: [], selectedNodeName: null, workflowName: "Untitled" };

function fakeProvider(reply: string): LlmProvider {
  return { interpret: async () => reply };
}

describe("interpretWithProvider — fail-closed wrapper around a provider call", () => {
  test("a valid action array from the provider passes through validation", async () => {
    const result = await interpretWithProvider(fakeProvider('{"actions":[{"type":"stopAll"}]}'), "stop everything", emptyContext);
    expect(result).toEqual({ ok: true, result: { kind: "actions", actions: [{ type: "stopAll" }] } });
  });

  test("a valid query from the provider passes through validation", async () => {
    const result = await interpretWithProvider(
      fakeProvider('{"query":{"type":"listByStatus","bucket":"running"}}'),
      "what is running",
      emptyContext,
    );
    expect(result).toEqual({ ok: true, result: { kind: "query", query: { type: "listByStatus", bucket: "running" } } });
  });

  test("malformed provider output fails closed with reason invalid_output", async () => {
    const result = await interpretWithProvider(fakeProvider("I'm not sure what you mean!"), "do something vague", emptyContext);
    expect(result).toEqual({ ok: false, reason: "invalid_output" });
  });

  test("a provider that throws (network error, auth failure, etc.) fails closed with reason provider_error, never throws to the caller", async () => {
    const throwingProvider: LlmProvider = {
      interpret: async () => {
        throw new Error("401 Unauthorized");
      },
    };
    const result = await interpretWithProvider(throwingProvider, "stop everything", emptyContext);
    expect(result).toEqual({ ok: false, reason: "provider_error" });
  });

  test("an action naming an unknown type is stripped by validation even if the provider is otherwise well-behaved", async () => {
    const result = await interpretWithProvider(fakeProvider('{"actions":[{"type":"deleteEverything"}]}'), "wipe it all", emptyContext);
    expect(result).toEqual({ ok: false, reason: "invalid_output" });
  });

  test("a natural-language multi-step request maps to an ordered action batch (the model's job; validation just accepts a well-formed result)", async () => {
    const reply = JSON.stringify({
      actions: [
        { type: "addNode", agentType: "claude-code", name: "Apollo" },
        { type: "addNode", agentType: "claude-code", name: "Reviewer" },
        { type: "connect", from: "Apollo", to: "Reviewer" },
        { type: "startNode", nodeRef: "Apollo" },
      ],
    });
    const result = await interpretWithProvider(fakeProvider(reply), "Create Apollo and Reviewer, connect Apollo to Reviewer, then start Apollo", emptyContext);
    expect(result.ok && result.result.kind === "actions" && result.result.actions).toHaveLength(4);
  });

  test("a read-only question about running agents maps to a query, not a fabricated action", async () => {
    const result = await interpretWithProvider(
      fakeProvider('{"query":{"type":"listByStatus","bucket":"waiting"}}'),
      "Which agent is waiting for me?",
      emptyContext,
    );
    expect(result).toEqual({ ok: true, result: { kind: "query", query: { type: "listByStatus", bucket: "waiting" } } });
  });

  test("a request the model can't safely resolve returns an empty actions array, which fails closed rather than executing nothing silently as success", async () => {
    const result = await interpretWithProvider(fakeProvider('{"actions":[]}'), "do something to a node that doesn't exist", emptyContext);
    expect(result).toEqual({ ok: false, reason: "invalid_output" });
  });

  test("the prompt sent to the provider includes workflow name, profile, and the query schema", async () => {
    let seenPrompt = "";
    const capturingProvider: LlmProvider = {
      interpret: async (prompt) => {
        seenPrompt = prompt;
        return '{"actions":[{"type":"stopAll"}]}';
      },
    };
    const context: CanvasCommandContext = {
      nodes: [{ name: "Apollo", agentType: "claude-code", status: "idle", profile: "Saurabh" }],
      edges: [],
      installedAgents: ["claude-code"],
      selectedNodeName: null,
      workflowName: "Backend Review",
    };
    await interpretWithProvider(capturingProvider, "stop apollo", context);
    expect(seenPrompt).toContain("Backend Review");
    expect(seenPrompt).toContain("Saurabh");
    expect(seenPrompt).toContain("listByStatus");
    expect(seenPrompt).not.toContain("workingDirectory");
  });
});
