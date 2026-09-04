import type { ConnectionRecord, NodeRecord, WorkflowSnapshot } from "./types";

export interface TeamWorkflowOptions {
  id?: string;
  name?: string;
  topicOrGoal?: string;
  workingDirectory?: string | null;
  defaultAgentType?: string;
}

/**
 * Creates a deterministic Team Workflow snapshot on the existing Canvas model.
 * Contains: Product Manager -> Software Architect -> Reviewer.
 *
 * @param optionsOrName - Configuration options or workflow name.
 * @param topicOrGoal - Optional topic or goal if first argument is a string.
 * @returns Fully formed WorkflowSnapshot ready to load or persist.
 */
export function createTeamWorkflowSnapshot(
  optionsOrName?: TeamWorkflowOptions | string,
  topicOrGoal?: string,
): WorkflowSnapshot {
  const options: TeamWorkflowOptions =
    typeof optionsOrName === "string"
      ? { name: optionsOrName, topicOrGoal }
      : optionsOrName ?? {};

  const workflowId = options.id ?? crypto.randomUUID();
  const name = options.name ?? "Team Workflow";
  const defaultAgent = options.defaultAgentType ?? "claude-code";
  const cwd = options.workingDirectory ?? null;
  const goal = options.topicOrGoal ?? "Design an architecture for a URL shortener.";

  const pmId = crypto.randomUUID();
  const archId = crypto.randomUUID();
  const revId = crypto.randomUUID();

  const nodes: NodeRecord[] = [
    {
      id: pmId,
      name: "Product Manager",
      kind: "agent",
      agentType: defaultAgent,
      adapterKind: "terminal",
      workingDirectory: cwd,
      roleId: "product-manager",
      config: {
        roleId: "product-manager",
        taskPrompt: `Analyze the user goal: "${goal}". Define product requirements, user stories, scope, and acceptance criteria.`,
        width: 560,
        height: 420,
      },
      position: { x: 80, y: 140 },
    },
    {
      id: archId,
      name: "Software Architect",
      kind: "agent",
      agentType: defaultAgent,
      adapterKind: "terminal",
      workingDirectory: cwd,
      roleId: "software-architect",
      config: {
        roleId: "software-architect",
        taskPrompt:
          "Based on the upstream product specifications, design the system architecture, component breakdown, data models, API contracts, and trade-off analysis.",
        width: 560,
        height: 420,
      },
      position: { x: 720, y: 140 },
    },
    {
      id: revId,
      name: "Reviewer",
      kind: "agent",
      agentType: defaultAgent,
      adapterKind: "terminal",
      workingDirectory: cwd,
      roleId: "reviewer",
      config: {
        roleId: "reviewer",
        taskPrompt:
          "Review the system architecture against all product requirements and acceptance criteria. Identify potential risks, edge cases, security issues, and provide an actionable verdict.",
        width: 560,
        height: 420,
      },
      position: { x: 1360, y: 140 },
    },
  ];

  const connections: ConnectionRecord[] = [
    {
      id: crypto.randomUUID(),
      fromNodeId: pmId,
      toNodeId: archId,
      autoApprove: false,
    },
    {
      id: crypto.randomUUID(),
      fromNodeId: archId,
      toNodeId: revId,
      autoApprove: false,
    },
  ];

  return {
    id: workflowId,
    name,
    workflowType: "team",
    nodes,
    connections,
  };
}

/**
 * Checks whether a workflow snapshot represents a Team workflow.
 *
 * @param workflow - Workflow snapshot or partial workflow definition.
 * @returns true if the workflow has workflowType 'team' or contains role-configured nodes.
 */
export function isTeamWorkflow(
  workflow: Partial<WorkflowSnapshot> | { workflowType?: string; nodes?: NodeRecord[] },
): boolean {
  if (workflow.workflowType === "team") return true;
  if (workflow.nodes && Array.isArray(workflow.nodes)) {
    return workflow.nodes.some((n) => Boolean(n.roleId || n.config?.roleId));
  }
  return false;
}
