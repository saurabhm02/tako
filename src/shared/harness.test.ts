import { describe, expect, it } from "bun:test";
import {
  formatHandoffContext,
  parseStructuredOutput,
  prepareExecution,
} from "./harness";
import { PRODUCT_MANAGER_ROLE, SOFTWARE_ARCHITECT_ROLE } from "./roles";
import type { RuntimeHandoff } from "./types";

describe("Harness and Execution Preparation", () => {
  it("formats upstream handoff context cleanly into structured markdown sections", () => {
    const handoffs: RuntimeHandoff[] = [
      {
        id: "h1",
        executionId: "exec-1",
        fromNodeId: "pm-1",
        toNodeId: "arch-1",
        sourceOutput: "# Product Requirements Document\n- Goal: Build a high-performance key-value store.",
        status: "delivered",
        timestamp: 100,
      },
    ];

    const result = formatHandoffContext(handoffs);
    expect(result.formattedText).toContain("--- Upstream Context 1 (from node pm-1) ---");
    expect(result.formattedText).toContain("Build a high-performance key-value store.");

    const multiHandoffs: RuntimeHandoff[] = [
      ...handoffs,
      {
        id: "h2",
        executionId: "exec-1",
        fromNodeId: "arch-1",
        toNodeId: "rev-1",
        sourceOutput: '```json\n{"architecture": "Distributed LSM-tree"}\n```',
        status: "delivered",
        timestamp: 200,
      },
    ];

    const multiResult = formatHandoffContext(multiHandoffs);
    expect(multiResult.formattedText).toContain("Upstream Context 1 (from node pm-1)");
    expect(multiResult.formattedText).toContain("Upstream Context 2 (from node arch-1)");
    expect(multiResult.structuredPayloads.length).toBe(1);
    expect(multiResult.structuredPayloads[0]).toEqual({ architecture: "Distributed LSM-tree" });
  });

  it("returns empty formatting when upstream handoff list is empty", () => {
    const res = formatHandoffContext([]);
    expect(res.formattedText).toBe("");
    expect(res.structuredPayloads).toEqual([]);
  });

  it("prepares execution text combining role system prompt, upstream context, and user prompt", () => {
    const prepared = prepareExecution(
      {
        roleId: "product-manager",
        taskInstructions: "Design a notification service.",
      },
      { directInput: "Design a notification service." },
    );

    expect(prepared.systemInstructions).toContain("[ROLE: Product Manager]");
    expect(prepared.systemInstructions).toContain("functional requirements");
    expect(prepared.promptText).toContain("[ROLE: Product Manager]");
    expect(prepared.promptText).toContain("[TASK]");
    expect(prepared.promptText).toContain("Design a notification service.");
    expect(prepared.promptText).not.toContain("[UPSTREAM INPUTS]");
  });

  it("includes formatted upstream context when provided in prepareExecution", () => {
    const upstream: RuntimeHandoff[] = [
      {
        id: "h-pm",
        executionId: "exec-1",
        fromNodeId: "pm-1",
        toNodeId: "arch-1",
        sourceOutput: "Functional requirements: Real-time notification routing.",
        status: "delivered",
        timestamp: 100,
      },
    ];

    const prepared = prepareExecution(
      {
        roleId: "software-architect",
        taskInstructions: "Create architectural specification.",
      },
      { upstreamContext: upstream },
    );

    expect(prepared.promptText).toContain("[UPSTREAM INPUTS]");
    expect(prepared.promptText).toContain("Upstream Context 1 (from node pm-1)");
    expect(prepared.promptText).toContain("Functional requirements: Real-time notification routing.");
    expect(prepared.promptText).toContain("[TASK]\nCreate architectural specification.");
  });

  it("attaches schema enforcement instructions when outputSchema is defined", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
        features: { type: "array", items: { type: "string" } },
      },
    };

    const prepared = prepareExecution(
      {
        roleId: "product-manager",
        outputSchema: schema,
        taskInstructions: "Define MVP features.",
      },
      {},
    );

    expect(prepared.systemInstructions).toContain("[OUTPUT CONTRACT]");
    expect(prepared.systemInstructions).toContain('"features"');
  });

  it("parses structured output from markdown code blocks or raw JSON gracefully", () => {
    const jsonBlock = "```json\n{\n  \"status\": \"approved\",\n  \"confidence\": 0.95\n}\n```";
    const parsed1 = parseStructuredOutput(jsonBlock);
    expect(parsed1).toEqual({ status: "approved", confidence: 0.95 });

    const rawJson = '{"verdict": "pass", "notes": ["all checks green"]}';
    const parsed2 = parseStructuredOutput(rawJson);
    expect(parsed2).toEqual({ verdict: "pass", notes: ["all checks green"] });

    const mixedText = "Here is the result:\n```\n{\n  \"score\": 100\n}\n```\nHope that helps!";
    const parsed3 = parseStructuredOutput(mixedText);
    expect(parsed3).toEqual({ score: 100 });
  });

  it("returns null for non-JSON or plain markdown text without throwing or breaking", () => {
    expect(parseStructuredOutput("Plain unstructured text output.")).toBeNull();
    expect(parseStructuredOutput("# Architecture\nThis is a standard markdown document.")).toBeNull();
    expect(parseStructuredOutput("")).toBeNull();
  });

  it("is completely adapter-independent with no dependency on runtime or adapter types", () => {
    const config = prepareExecution(
      {
        taskInstructions: "Execute pure task",
      },
      {},
    );

    expect(config.systemInstructions).toBe("");
    expect(config.promptText).toContain("[TASK]\nExecute pure task");
    expect(config.metadata.roleId).toBeNull();
  });

  it("compiles prohibited boundaries, allowed responsibilities, failure conditions, and handoff contracts for roles", () => {
    const pmExec = prepareExecution(
      {
        roleId: "product-manager",
        taskInstructions: "Define auth requirements",
      },
      {},
    );

    expect(pmExec.systemInstructions).toContain("[ALLOWED RESPONSIBILITIES]");
    expect(pmExec.systemInstructions).toContain("[PROHIBITED ACTIONS & BOUNDARIES]");
    expect(pmExec.systemInstructions).toContain("MUST NOT: Implementing application source code");
    expect(pmExec.systemInstructions).toContain("[FAILURE CONDITIONS (REJECT IF)]");
    expect(pmExec.systemInstructions).toContain("[HANDOFF CONTRACT]");
    expect(pmExec.systemInstructions).toContain('Downstream Role: "software-architect"');
    expect(pmExec.metadata.prohibitedResponsibilities).toBeDefined();
    expect((pmExec.metadata.prohibitedResponsibilities as string[]).length).toBeGreaterThan(0);

    const archExec = prepareExecution(
      {
        roleId: "software-architect",
        taskInstructions: "Design event bus architecture",
      },
      {},
    );

    expect(archExec.systemInstructions).toContain("[PROHIBITED ACTIONS & BOUNDARIES]");
    expect(archExec.systemInstructions).toContain("MUST NOT: Modifying product scope or overriding business requirements");
    expect(archExec.systemInstructions).toContain("[HANDOFF CONTRACT]");
    expect(archExec.systemInstructions).toContain('Downstream Role: "reviewer"');

    const revExec = prepareExecution(
      {
        roleId: "reviewer",
        taskInstructions: "Audit security architecture",
      },
      {},
    );

    expect(revExec.systemInstructions).toContain("[PROHIBITED ACTIONS & BOUNDARIES]");
    expect(revExec.systemInstructions).toContain("MUST NOT: Silently fixing code or modifying architectural specifications");
    expect(revExec.systemInstructions).toContain("[FAILURE CONDITIONS (REJECT IF)]");
    expect(revExec.systemInstructions).toContain("[OUTPUT CONTRACT]");
    expect(revExec.systemInstructions).toContain('"verdict"');
  });
});
