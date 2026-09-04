import { beforeEach, describe, expect, test } from "bun:test";
import { closeDatabaseForTests, initDatabase } from "./db";
import { resetCurrentRunForTests } from "./runsRepo";
import {
  listWorkflows,
  loadWorkflow,
  saveWorkflow,
} from "./workflowsRepo";
import { createTeamWorkflowSnapshot } from "../../shared/team";
import type { WorkflowSnapshot } from "../../shared/types";

beforeEach(() => {
  closeDatabaseForTests();
  initDatabase(":memory:");
  resetCurrentRunForTests();
});

describe("workflowsRepo - Role and Team Persistence", () => {
  test("persists and retrieves team workflow snapshots with workflowType and roleId", () => {
    const team = createTeamWorkflowSnapshot({
      name: "Engineering Core Team",
      topicOrGoal: "Build a microservices architecture.",
    });

    saveWorkflow(team);

    const loaded = loadWorkflow(team.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(team.id);
    expect(loaded?.name).toBe("Engineering Core Team");
    expect(loaded?.workflowType).toBe("team");
    expect(loaded?.nodes.length).toBe(3);

    const pm = loaded?.nodes.find((n) => n.name === "Product Manager");
    const arch = loaded?.nodes.find((n) => n.name === "Software Architect");
    const rev = loaded?.nodes.find((n) => n.name === "Reviewer");

    expect(pm?.roleId).toBe("product-manager");
    expect(arch?.roleId).toBe("software-architect");
    expect(rev?.roleId).toBe("reviewer");

    expect(loaded?.connections.length).toBe(2);
  });

  test("listWorkflows includes workflowType in summary rows", () => {
    const team = createTeamWorkflowSnapshot({ name: "Team A" });
    const standard: WorkflowSnapshot = {
      id: "wf-std",
      name: "Canvas A",
      workflowType: "canvas",
      nodes: [],
      connections: [],
    };

    saveWorkflow(team);
    saveWorkflow(standard);

    const list = listWorkflows();
    const teamSummary = list.find((w) => w.id === team.id);
    const stdSummary = list.find((w) => w.id === standard.id);

    expect(teamSummary?.workflowType).toBe("team");
    expect(stdSummary?.workflowType).toBe("canvas");
  });

  test("updates roleId in-place across saves without foreign key violations", () => {
    const workflowId = "wf-role-update";
    const initialSnapshot: WorkflowSnapshot = {
      id: workflowId,
      name: "Dynamic Roles",
      workflowType: "canvas",
      nodes: [
        {
          id: "node-1",
          name: "Agent 1",
          kind: "agent",
          agentType: "claude-code",
          adapterKind: "terminal",
          workingDirectory: null,
          roleId: null,
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };

    saveWorkflow(initialSnapshot);
    let loaded = loadWorkflow(workflowId);
    expect(loaded?.nodes[0].roleId).toBeNull();

    // Assign role
    const updatedSnapshot: WorkflowSnapshot = {
      ...initialSnapshot,
      nodes: [
        {
          ...initialSnapshot.nodes[0],
          roleId: "product-manager",
        },
      ],
    };

    saveWorkflow(updatedSnapshot);
    loaded = loadWorkflow(workflowId);
    expect(loaded?.nodes[0].roleId).toBe("product-manager");

    // Clear role
    const clearedSnapshot: WorkflowSnapshot = {
      ...initialSnapshot,
      nodes: [
        {
          ...initialSnapshot.nodes[0],
          roleId: null,
        },
      ],
    };

    saveWorkflow(clearedSnapshot);
    loaded = loadWorkflow(workflowId);
    expect(loaded?.nodes[0].roleId).toBeNull();
  });

  test("backward compatibility: default canvas workflows with null roleId load seamlessly", () => {
    const legacyWorkflow: WorkflowSnapshot = {
      id: "legacy-1",
      name: "Legacy Workflow",
      nodes: [
        {
          id: "leg-n1",
          name: "Old Terminal",
          kind: "agent",
          agentType: "bash",
          adapterKind: "terminal",
          workingDirectory: "/tmp",
          config: {},
          position: { x: 10, y: 10 },
        },
      ],
      connections: [],
    };

    saveWorkflow(legacyWorkflow);

    const loaded = loadWorkflow("legacy-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.workflowType).toBe("canvas");
    expect(loaded?.nodes[0].roleId).toBeNull();
  });
});
