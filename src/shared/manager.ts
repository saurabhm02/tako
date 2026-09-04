import { getRoleDefinition } from "./roles";
import type { ConnectionRecord, NodeRecord, WorkflowSnapshot } from "./types";
import { validateWorkflow } from "./workflowValidation";

/**
 * Request specification passed to the Manager to plan a workflow.
 */
export interface ManagerRequest {
  /** The high-level user goal or initiative (e.g. "Build an invoice management SaaS"). */
  goal: string;
  /** Optional custom workflow display name. */
  name?: string;
  /** Optional domain constraints or requirements. */
  constraints?: string[];
  /** Default or preferred agent adapter type (defaults to "claude-code"). */
  preferredAgent?: string;
  /** Workspace directory for execution. */
  workingDirectory?: string | null;
  /** Additional project or environment context. */
  projectContext?: Record<string, unknown>;
}

/**
 * Deterministic plan produced by the Manager.
 */
export interface ManagerPlan {
  /** Original user goal. */
  goal: string;
  /** Short, user-safe explanation of the selected workflow strategy (NO hidden chain-of-thought). */
  reasoningSummary: string;
  /** Ordered list of role IDs chosen to execute the goal. */
  selectedRoles: string[];
  /** Persisted Canvas node records representing each role. */
  workflowNodes: NodeRecord[];
  /** Persisted Canvas connections linking stages in the workflow. */
  workflowConnections: ConnectionRecord[];
  /** Explicit high-level assumptions identified for this workflow. */
  assumptions: string[];
  /** High-level project or architectural risks identified. */
  risks: string[];
  /** Additional plan metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Pluggable Manager Planner interface allowing future LLM-based planners to swap in seamlessly.
 */
export interface ManagerPlanner {
  createPlan(request: ManagerRequest): ManagerPlan;
}

export type GoalCategory = "build" | "research" | "architecture" | "requirements" | "default";

/**
 * Classifies a high-level user goal into a deterministic role structure.
 */
export function classifyGoal(goal: string): {
  category: GoalCategory;
  roles: string[];
  summary: string;
  assumptions: string[];
  risks: string[];
} {
  const normalized = (goal || "").trim().toLowerCase();

  // 1. Research request
  if (
    /^(?:research|investigate|study|explore|analyze\s+market)\b/i.test(normalized) ||
    /\b(research|market analysis|competitor analysis|feasibility study|landscape analysis)\b/i.test(normalized)
  ) {
    return {
      category: "research",
      roles: ["manager", "product-manager", "reviewer"],
      summary:
        "Created a 3-stage research workflow with Manager planning, Product Manager requirements analysis, and Reviewer verification.",
      assumptions: [
        "Goal focuses on exploratory domain research and requirements elicitation.",
        "No production software architecture or implementation is required.",
      ],
      risks: [
        "Unclear or shifting market scope during discovery.",
        "Missing empirical benchmarks or user signals.",
      ],
    };
  }

  // 2. Architecture request
  if (
    /\b(architecture|architectural|system design|infrastructure|database schema|api contract|data modeling|microservices)\b/i.test(
      normalized,
    ) &&
    !/\b(build\s+(?:an?\s+)?(?:app|application|saas|service|website))\b/i.test(normalized)
  ) {
    return {
      category: "architecture",
      roles: ["manager", "software-architect", "reviewer"],
      summary:
        "Created a 3-stage architecture workflow with Manager planning, Software Architect system design, and Reviewer verification.",
      assumptions: [
        "Product requirements and business goals are already established.",
        "Objective is pure technical design, component boundaries, and trade-off analysis.",
      ],
      risks: [
        "Unvalidated performance assumptions under peak concurrent load.",
        "Data schema migration complexity and distributed consistency edge cases.",
      ],
    };
  }

  // 3. Requirements / PRD request
  if (
    /\b(requirements?|prd|spec|specs|specifications?|user stories|scope definition|feature spec)\b/i.test(
      normalized,
    ) &&
    !/\b(build|develop|code|implement)\b/i.test(normalized)
  ) {
    return {
      category: "requirements",
      roles: ["manager", "product-manager", "reviewer"],
      summary:
        "Created a 3-stage requirements workflow with Manager planning, Product Manager specification, and Reviewer verification.",
      assumptions: [
        "Objective is defining functional requirements, user stories, and acceptance criteria.",
        "Technical system architecture will be planned in a downstream initiative.",
      ],
      risks: [
        "Ambiguity in edge cases and failure modes.",
        "Undefined non-goals leading to scope creep.",
      ],
    };
  }

  // 4. Product / Build request (default)
  return {
    category: "build",
    roles: ["manager", "product-manager", "software-architect", "reviewer"],
    summary:
      "Created a 4-stage delivery workflow with Manager planning, Product Manager requirements, Software Architect system design, and Reviewer verification.",
    assumptions: [
      "Standard modern web/backend runtime environment and infrastructure.",
      "Stages will execute sequentially with structured handoffs between roles.",
    ],
    risks: [
      "Scope expansion across multiple feature areas.",
      "Latency, availability, or consistency bottlenecks if architectural trade-offs are not validated.",
    ],
  };
}

/**
 * Deterministic implementation of ManagerPlanner.
 */
export class DeterministicManagerPlanner implements ManagerPlanner {
  createPlan(request: ManagerRequest): ManagerPlan {
    const rawGoal = request.goal?.trim();
    if (!rawGoal) {
      throw new Error("Manager goal cannot be empty.");
    }

    const { category, roles, summary, assumptions, risks } = classifyGoal(rawGoal);
    const defaultAgent = request.preferredAgent || "claude-code";
    const cwd = request.workingDirectory ?? null;

    const nodes: NodeRecord[] = [];
    const connections: ConnectionRecord[] = [];

    // Horizontal layout with 640px spacing
    const START_X = 80;
    const START_Y = 140;
    const SPACING_X = 640;

    for (let i = 0; i < roles.length; i++) {
      const roleId = roles[i];
      const roleDef = getRoleDefinition(roleId);
      const roleName = roleDef?.name || roleId;
      const nodeId = crypto.randomUUID();

      let taskPrompt = "";
      if (roleId === "manager") {
        taskPrompt = `Decompose user goal: "${rawGoal}". Formulate structured workflow intent, assumptions, and risks for downstream team execution.`;
      } else if (roleId === "product-manager") {
        taskPrompt = `Based on the user goal "${rawGoal}", author comprehensive functional specifications, scope boundaries (with non-goals), user stories, and testable acceptance criteria.`;
      } else if (roleId === "software-architect") {
        taskPrompt = `Based on upstream requirements, design the system architecture, component boundaries, data models, API contracts, and evaluate technical trade-offs.`;
      } else if (roleId === "reviewer") {
        taskPrompt = `Audit the proposed specifications and architecture against all acceptance criteria. Identify defects, security risks, evaluate severity, and issue a definitive verdict.`;
      } else {
        taskPrompt = `Execute specialized responsibilities for role "${roleName}" for goal: "${rawGoal}".`;
      }

      nodes.push({
        id: nodeId,
        name: roleName,
        kind: "agent",
        agentType: defaultAgent,
        adapterKind: "terminal",
        workingDirectory: cwd,
        roleId,
        config: {
          roleId,
          taskPrompt,
          goal: rawGoal,
          category,
          width: 560,
          height: 420,
        },
        position: {
          x: START_X + i * SPACING_X,
          y: START_Y,
        },
      });

      // Sequential connection from previous node
      if (i > 0) {
        const prevNodeId = nodes[i - 1].id;
        connections.push({
          id: crypto.randomUUID(),
          fromNodeId: prevNodeId,
          toNodeId: nodeId,
          autoApprove: false,
        });
      }
    }

    return {
      goal: rawGoal,
      reasoningSummary: summary,
      selectedRoles: roles,
      workflowNodes: nodes,
      workflowConnections: connections,
      assumptions,
      risks,
      metadata: {
        category,
        constraints: request.constraints ?? [],
      },
    };
  }
}

/**
 * Generates a validated WorkflowSnapshot from a ManagerRequest using a ManagerPlanner.
 *
 * @param request - The ManagerRequest describing the high-level goal and options.
 * @param planner - Optional custom ManagerPlanner (defaults to DeterministicManagerPlanner).
 * @returns Fully validated WorkflowSnapshot ready to persist or render on Canvas.
 */
export function generateManagerWorkflow(
  request: ManagerRequest,
  planner: ManagerPlanner = new DeterministicManagerPlanner(),
): WorkflowSnapshot {
  if (!request || typeof request.goal !== "string" || !request.goal.trim()) {
    throw new Error("Cannot generate manager workflow: user goal is required.");
  }

  const plan = planner.createPlan(request);
  const workflowId = crypto.randomUUID();
  const workflowName =
    request.name?.trim() ||
    `Team: ${request.goal.trim().slice(0, 40)}${request.goal.trim().length > 40 ? "..." : ""}`;

  const snapshot: WorkflowSnapshot = {
    id: workflowId,
    name: workflowName,
    workflowType: "team",
    nodes: plan.workflowNodes,
    connections: plan.workflowConnections,
  };

  // Validate the generated workflow
  const validation = validateWorkflow(snapshot, { disallowCycles: true });
  if (!validation.valid) {
    throw new Error(`Generated workflow failed validation: ${validation.errors.join(", ")}`);
  }

  return snapshot;
}
