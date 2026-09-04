import { describe, expect, it } from "bun:test";
import {
  interpret,
  normalizeRoleId,
  resolveAction,
  type ResolveContext,
} from "./commandLayer";
import type { TakoNode } from "./types";
import type { AdapterManifestSummary } from "../../shared/types";

describe("Command Layer — Team & Role Commands", () => {
  it("normalizes role names and aliases to canonical role IDs", () => {
    expect(normalizeRoleId("product manager")).toBe("product-manager");
    expect(normalizeRoleId("pm")).toBe("product-manager");
    expect(normalizeRoleId("product-manager")).toBe("product-manager");

    expect(normalizeRoleId("software architect")).toBe("software-architect");
    expect(normalizeRoleId("architect")).toBe("software-architect");
    expect(normalizeRoleId("software-architect")).toBe("software-architect");

    expect(normalizeRoleId("reviewer")).toBe("reviewer");
    expect(normalizeRoleId("code reviewer")).toBe("reviewer");

    expect(normalizeRoleId("none")).toBeNull();
    expect(normalizeRoleId("clear")).toBeNull();
  });

  it("interprets team creation commands", () => {
    const res1 = interpret("create team workflow");
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.actions[0]).toEqual({ type: "createTeamWorkflow", name: undefined, goal: undefined });
    }

    const res2 = interpret("new team workflow called 'Billing Engine' with goal Build Stripe billing system");
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.actions[0]).toEqual({
        type: "createTeamWorkflow",
        name: "Billing Engine",
        goal: "Build Stripe billing system",
      });
    }

    const res3 = interpret("create team for Cache Invalidation");
    expect(res3.ok).toBe(true);
    if (res3.ok) {
      expect(res3.actions[0]).toEqual({
        type: "createTeamWorkflow",
        name: undefined,
        goal: "Cache Invalidation",
      });
    }
  });

  it("interprets set role commands across multiple natural language variations", () => {
    const res1 = interpret("set role product-manager on Apollo");
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.actions[0]).toEqual({
        type: "setRole",
        nodeRef: "Apollo",
        roleId: "product-manager",
      });
    }

    const res2 = interpret("make Apollo a product manager");
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.actions[0]).toEqual({
        type: "setRole",
        nodeRef: "Apollo",
        roleId: "product-manager",
      });
    }

    const res3 = interpret("assign software architect to Athena");
    expect(res3.ok).toBe(true);
    if (res3.ok) {
      expect(res3.actions[0]).toEqual({
        type: "setRole",
        nodeRef: "Athena",
        roleId: "software-architect",
      });
    }

    const res4 = interpret("clear role on Apollo");
    expect(res4.ok).toBe(true);
    if (res4.ok) {
      expect(res4.actions[0]).toEqual({
        type: "setRole",
        nodeRef: "Apollo",
        roleId: null,
      });
    }
  });

  it("resolves setRole actions against real canvas nodes", () => {
    const apolloNode: TakoNode = {
      id: "node-apollo",
      type: "agentNode",
      position: { x: 0, y: 0 },
      data: {
        name: "Apollo",
        agentType: "claude-code",
        adapterKind: "terminal",
        workingDirectory: null,
        config: {},
        status: "not_started",
        error: null,
        lastActivityAt: null,
        lastCodeChange: null,
      },
    };

    const mockAdapters: AdapterManifestSummary[] = [
      {
        agentType: "claude-code",
        displayName: "Claude Code",
        kind: "terminal",
        installed: true,
        workingDirectoryRequired: false,
      },
    ];

    const ctx: ResolveContext = {
      nodes: [apolloNode],
      edges: [],
      adapters: mockAdapters,
      profilesByAgentType: {},
      selectedNodeId: null,
    };

    const resolved = resolveAction({ type: "setRole", nodeRef: "Apollo", roleId: "product-manager" }, ctx);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.action).toEqual({
        kind: "setRole",
        nodeId: "node-apollo",
        roleId: "product-manager",
      });
      expect(resolved.description).toContain('Set role "Product Manager" on "Apollo"');
    }

    const cleared = resolveAction({ type: "setRole", nodeRef: "Apollo", roleId: null }, ctx);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.action).toEqual({
        kind: "setRole",
        nodeId: "node-apollo",
        roleId: null,
      });
      expect(cleared.description).toContain('Clear role on "Apollo"');
    }
  });

  it("resolves createTeamWorkflow actions cleanly", () => {
    const ctx: ResolveContext = {
      nodes: [],
      edges: [],
      adapters: [],
      profilesByAgentType: {},
      selectedNodeId: null,
    };

    const resolved = resolveAction(
      { type: "createTeamWorkflow", name: "Core Team", goal: "Build Auth Service" },
      ctx,
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.action).toEqual({
        kind: "createTeamWorkflow",
        name: "Core Team",
        goal: "Build Auth Service",
      });
      expect(resolved.description).toContain('Create team workflow "Core Team" with goal "Build Auth Service"');
    }
  });

  it("interprets and resolves manager workflow generation commands", () => {
    const res1 = interpret("create manager workflow for Build a SaaS invoice system");
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.actions[0]).toEqual({
        type: "createManagerWorkflow",
        name: undefined,
        goal: "Build a SaaS invoice system",
      });
    }

    const res2 = interpret("plan workflow to Design a payment gateway");
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.actions[0]).toEqual({
        type: "createManagerWorkflow",
        goal: "Design a payment gateway",
      });
    }

    const res3 = interpret("generate workflow to Build a mobile banking app");
    expect(res3.ok).toBe(true);
    if (res3.ok) {
      expect(res3.actions[0]).toEqual({
        type: "createManagerWorkflow",
        goal: "Build a mobile banking app",
      });
    }

    const ctx: ResolveContext = {
      nodes: [],
      edges: [],
      adapters: [],
      profilesByAgentType: {},
      selectedNodeId: null,
    };

    const resolved = resolveAction(
      { type: "createManagerWorkflow", goal: "Build an e-commerce platform" },
      ctx,
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.action.kind).toBe("createManagerWorkflow");
      expect((resolved.action as { goal: string }).goal).toBe("Build an e-commerce platform");
      expect(resolved.description).toContain("Generate manager workflow");
    }
  });
});
