import { describe, expect, it } from "bun:test";
import { createTeamWorkflowSnapshot, isTeamWorkflow } from "./team";
import { isAgentNode, nodeRecordToTakoNode } from "../renderer/canvas/types";

describe("Team Workflow Foundation", () => {
  it("creates a deterministic 3-node PM -> Architect -> Reviewer pipeline", () => {
    const snapshot = createTeamWorkflowSnapshot({
      name: "Shortener Team",
      topicOrGoal: "Build a scalable URL shortener with analytics.",
    });

    expect(snapshot.id).toBeDefined();
    expect(snapshot.name).toBe("Shortener Team");
    expect(snapshot.workflowType).toBe("team");
    expect(snapshot.nodes.length).toBe(3);
    expect(snapshot.connections.length).toBe(2);

    const [pmNode, archNode, revNode] = snapshot.nodes;

    // PM Node
    expect(pmNode.name).toBe("Product Manager");
    expect(pmNode.roleId).toBe("product-manager");
    expect(pmNode.kind).toBe("agent");
    expect((pmNode.config as Record<string, unknown>).taskPrompt).toContain("URL shortener");

    // Architect Node
    expect(archNode.name).toBe("Software Architect");
    expect(archNode.roleId).toBe("software-architect");
    expect(archNode.kind).toBe("agent");

    // Reviewer Node
    expect(revNode.name).toBe("Reviewer");
    expect(revNode.roleId).toBe("reviewer");
    expect(revNode.kind).toBe("agent");

    // Connections: PM -> Arch, Arch -> Rev
    const [conn1, conn2] = snapshot.connections;
    expect(conn1.fromNodeId).toBe(pmNode.id);
    expect(conn1.toNodeId).toBe(archNode.id);
    expect(conn2.fromNodeId).toBe(archNode.id);
    expect(conn2.toNodeId).toBe(revNode.id);
  });

  it("supports string parameters for quick workflow initialization", () => {
    const snapshot = createTeamWorkflowSnapshot("Quick Workflow", "Build a markdown editor.");
    expect(snapshot.name).toBe("Quick Workflow");
    expect(snapshot.workflowType).toBe("team");
    expect(snapshot.nodes[0].config?.taskPrompt).toContain("markdown editor");
  });

  it("correctly identifies team workflows using isTeamWorkflow helper", () => {
    const team = createTeamWorkflowSnapshot();
    expect(isTeamWorkflow(team)).toBe(true);

    const standardCanvasWorkflow = {
      id: "std-1",
      name: "Standard Canvas",
      workflowType: "canvas" as const,
      nodes: [
        {
          id: "n-1",
          name: "Terminal",
          kind: "agent" as const,
          agentType: "bash",
          adapterKind: "terminal" as const,
          workingDirectory: null,
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };
    expect(isTeamWorkflow(standardCanvasWorkflow)).toBe(false);

    // If a node has a roleId, it is also identified as a team workflow
    const workflowWithRoleNode = {
      id: "w-role",
      name: "Custom Workflow",
      nodes: [
        {
          id: "n-1",
          name: "PM Node",
          kind: "agent" as const,
          agentType: "claude-code",
          adapterKind: "terminal" as const,
          roleId: "product-manager",
          workingDirectory: null,
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };
    expect(isTeamWorkflow(workflowWithRoleNode)).toBe(true);
  });

  it("maps cleanly to Canvas TakoNode instances with roleId preserved on AgentNodeData", () => {
    const snapshot = createTeamWorkflowSnapshot();
    const takoNodes = snapshot.nodes.map(nodeRecordToTakoNode);

    expect(takoNodes.length).toBe(3);
    for (const node of takoNodes) {
      expect(isAgentNode(node)).toBe(true);
      if (isAgentNode(node)) {
        expect(node.data.roleId).toBeDefined();
        expect(["product-manager", "software-architect", "reviewer"]).toContain(node.data.roleId!);
      }
    }
  });
});
