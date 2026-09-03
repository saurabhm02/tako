import { describe, expect, it } from "bun:test";
import { validateWorkflow } from "./workflowValidation";
import type { NodeRecord, WorkflowSnapshot } from "./types";

describe("Workflow Validation Layer", () => {
  it("rejects workflows with no nodes", () => {
    const wf: WorkflowSnapshot = {
      id: "wf-1",
      name: "Empty WF",
      nodes: [],
      connections: [],
    };
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Workflow has no nodes");
  });

  it("rejects workflows containing only passive notes", () => {
    const wf: WorkflowSnapshot = {
      id: "wf-1",
      name: "Notes Only",
      nodes: [
        {
          id: "note-1",
          name: "Project Plan",
          kind: "note",
          agentType: "note",
          adapterKind: "terminal",
          workingDirectory: null,
          config: { text: "Some notes" },
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("contains only passive notes");
  });

  it("rejects workflows with unavailable agent CLIs when checked against installed adapters", () => {
    const wf: WorkflowSnapshot = {
      id: "wf-1",
      name: "Unavailable CLI WF",
      nodes: [
        {
          id: "n1",
          name: "Gemini Node",
          kind: "agent",
          agentType: "gemini",
          adapterKind: "terminal",
          workingDirectory: "/tmp",
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };
    const installed = new Set(["claude-code", "bash"]);
    const result = validateWorkflow(wf, { installedAgentTypes: installed });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("is not installed or not available on PATH");
  });

  it("always allows bash / Terminal nodes even if not explicitly in installed set", () => {
    const wf: WorkflowSnapshot = {
      id: "wf-1",
      name: "Terminal WF",
      nodes: [
        {
          id: "n1",
          name: "Terminal Node",
          kind: "agent",
          agentType: "bash",
          adapterKind: "terminal",
          workingDirectory: "/tmp",
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };
    const result = validateWorkflow(wf, { installedAgentTypes: new Set(["claude-code"]) });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("detects broken connections referencing missing nodes", () => {
    const wf: WorkflowSnapshot = {
      id: "wf-1",
      name: "Broken Edge WF",
      nodes: [
        {
          id: "n1",
          name: "Claude",
          kind: "agent",
          agentType: "claude-code",
          adapterKind: "terminal",
          workingDirectory: "/tmp",
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      connections: [
        {
          id: "c1",
          fromNodeId: "n1",
          toNodeId: "missing-node",
          autoApprove: false,
        },
      ],
    };
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("references a missing target node");
  });

  it("rejects self-connections", () => {
    const wf: WorkflowSnapshot = {
      id: "wf-1",
      name: "Self Loop WF",
      nodes: [
        {
          id: "n1",
          name: "Claude",
          kind: "agent",
          agentType: "claude-code",
          adapterKind: "terminal",
          workingDirectory: "/tmp",
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      connections: [
        {
          id: "c1",
          fromNodeId: "n1",
          toNodeId: "n1",
          autoApprove: false,
        },
      ],
    };
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Self-connection detected");
  });

  it("flags duplicate connections as warnings without invalidating the run", () => {
    const wf: WorkflowSnapshot = {
      id: "wf-1",
      name: "Duplicate Edge WF",
      nodes: [
        {
          id: "n1",
          name: "Claude",
          kind: "agent",
          agentType: "claude-code",
          adapterKind: "terminal",
          workingDirectory: "/tmp",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: "n2",
          name: "Codex",
          kind: "agent",
          agentType: "codex",
          adapterKind: "terminal",
          workingDirectory: "/tmp",
          config: {},
          position: { x: 200, y: 0 },
        },
      ],
      connections: [
        {
          id: "c1",
          fromNodeId: "n1",
          toNodeId: "n2",
          autoApprove: false,
        },
        {
          id: "c2",
          fromNodeId: "n1",
          toNodeId: "n2",
          autoApprove: true,
        },
      ],
    };
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("Duplicate connection");
  });

  it("accepts valid workflows", () => {
    const wf: WorkflowSnapshot = {
      id: "wf-1",
      name: "Valid Pipeline",
      nodes: [
        {
          id: "n1",
          name: "Claude",
          kind: "agent",
          agentType: "claude-code",
          adapterKind: "terminal",
          workingDirectory: "/tmp",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: "n2",
          name: "Codex",
          kind: "agent",
          agentType: "codex",
          adapterKind: "terminal",
          workingDirectory: "/tmp",
          config: {},
          position: { x: 200, y: 0 },
        },
      ],
      connections: [
        {
          id: "c1",
          fromNodeId: "n1",
          toNodeId: "n2",
          autoApprove: false,
        },
      ],
    };
    const installed = new Set(["claude-code", "codex"]);
    const result = validateWorkflow(wf, { installedAgentTypes: installed });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});
