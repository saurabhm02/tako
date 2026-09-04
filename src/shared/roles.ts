/**
 * Role abstraction for Team Orchestration (Phase 1 Production-Grade).
 * Defines WHAT an agent is supposed to do, decoupled from HOW the agent executes (Adapter).
 * Every role includes an explicit execution contract defining purpose, allowed & prohibited
 * responsibilities, instructions, capabilities, tools, contracts, acceptance criteria,
 * failure conditions, and downstream handoffs.
 */

export interface RoleHandoffContract {
  /** Target role ID expected to consume this output, or null if terminal/user delivery. */
  downstreamRoleId: string | null;
  /** Description of what is delivered and how the downstream role should use it. */
  description: string;
  /** Required artifact types or key sections expected in the handoff payload. */
  expectedSections?: string[];
}

export interface RoleDefinition {
  /** Unique canonical identifier for the role (e.g. "product-manager"). */
  id: string;
  /** Human-readable display name (e.g. "Product Manager"). */
  name: string;
  /** High-level description of responsibilities. */
  description: string;
  /** Core purpose and objective of the role. */
  purpose: string;
  /** Primary responsibilities of the role. */
  responsibilities: string[];
  /** Explicit list of permitted activities and domains. */
  allowedResponsibilities: string[];
  /** Explicit list of strictly prohibited activities and anti-patterns. */
  prohibitedResponsibilities: string[];
  /** Base system prompt instructions defining the role's behavior and standards. */
  instructions: string;
  /** List of capabilities or skills this role possesses. */
  capabilities: string[];
  /** Permitted tools or execution capabilities for this role. */
  allowedTools: string[];
  /** Recommended default agent type if unspecified (e.g. "claude-code"). */
  defaultAgentType: string;
  /** Optional structured JSON Schema defining the expected input contract. */
  inputContract?: Record<string, unknown> | null;
  /** Backward-compatible alias for inputContract. */
  inputSchema?: Record<string, unknown> | null;
  /** Optional structured JSON Schema defining the expected output contract. */
  outputContract?: Record<string, unknown> | null;
  /** Backward-compatible alias for outputContract. */
  outputSchema?: Record<string, unknown> | null;
  /** Explicit quality criteria and guidelines the role must fulfill. */
  acceptanceCriteria: string[];
  /** Explicit conditions under which the role output is considered failed or rejected. */
  failureConditions: string[];
  /** Downstream handoff contract defining target recipient and expectations. */
  handoffContract: RoleHandoffContract;
  /** Visual brand accent color for badges and UI. */
  brandColor?: string;
  /** Icon name or descriptor. */
  icon?: string;
}

export const PRODUCT_MANAGER_ROLE: RoleDefinition = {
  id: "product-manager",
  name: "Product Manager",
  description: "Defines product requirements, scope boundaries, user stories, and acceptance criteria.",
  purpose:
    "Transform user goals and problem statements into unambiguous, prioritized functional specifications, user stories, scope boundaries, and acceptance criteria.",
  responsibilities: [
    "Analyze user requests, problem statements, and business objectives",
    "Define clear scope boundaries, including explicit non-goals",
    "Author comprehensive functional requirements and user stories",
    "Specify testable acceptance criteria for downstream technical architecture",
    "Identify product risks, dependencies, and assumptions",
  ],
  allowedResponsibilities: [
    "Requirements elicitation and functional specification",
    "User story authoring with acceptance criteria",
    "Scope definition and explicit non-goals delineation",
    "Product risk, assumption, and dependency identification",
    "Feature prioritization and success metrics definition",
  ],
  prohibitedResponsibilities: [
    "Implementing application source code, scripts, or runtime logic",
    "Designing technical software architecture, database schemas, or API implementation details",
    "Selecting low-level programming libraries, data structures, or code algorithms",
    "Executing terminal commands, builds, or deployment scripts",
  ],
  instructions:
    "You are an experienced Product Manager. Your role is to analyze user requests, break them down into clear functional requirements, user stories, edge cases, scope definitions (including explicit non-goals), and testable acceptance criteria. Provide structured, actionable product specifications. Do NOT write source code or design technical system architecture.",
  defaultAgentType: "claude-code",
  capabilities: [
    "requirements-definition",
    "user-stories",
    "scope-management",
    "acceptance-criteria",
    "edge-case-analysis",
    "non-goals-definition",
  ],
  allowedTools: [
    "spec-document-generator",
    "requirements-analyzer",
    "read-only-file-access",
  ],
  inputContract: {
    type: "object",
    properties: {
      directInput: { type: "string", description: "User request or goal" },
      context: { type: "object", description: "Project context" },
    },
    required: ["directInput"],
  },
  inputSchema: {
    type: "object",
    properties: {
      directInput: { type: "string", description: "User request or goal" },
      context: { type: "object", description: "Project context" },
    },
    required: ["directInput"],
  },
  outputContract: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Executive summary and problem statement" },
      scope: {
        type: "object",
        properties: {
          inScope: { type: "array", items: { type: "string" } },
          outOfScope: { type: "array", items: { type: "string" } },
        },
        required: ["inScope", "outOfScope"],
      },
      userStories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            story: { type: "string" },
            acceptanceCriteria: { type: "array", items: { type: "string" } },
          },
          "required": ["id", "title", "story", "acceptanceCriteria"],
        },
      },
      functionalRequirements: { type: "array", items: { type: "string" } },
      risksAndAssumptions: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "scope", "userStories", "functionalRequirements"],
  },
  outputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Executive summary of the product initiative" },
      requirements: { type: "array", items: { type: "string" }, description: "Core functional requirements" },
      scope: { type: "string", description: "Scope boundaries and non-goals" },
      acceptanceCriteria: {
        type: "array",
        items: { type: "string" },
        description: "Testable criteria for downstream architecture",
      },
    },
    required: ["summary", "requirements", "acceptanceCriteria"],
  },
  acceptanceCriteria: [
    "Every requirement is unambiguous, testable, and tied to a user need",
    "Scope contains explicit in-scope and out-of-scope (non-goals) items",
    "User stories include concrete, testable acceptance criteria",
    "No code implementations or technical architecture designs are emitted",
  ],
  failureConditions: [
    "Emits source code or technical architecture blueprints instead of specifications",
    "Fails to define explicit out-of-scope non-goals",
    "Omits testable acceptance criteria from user stories",
    "Produces ambiguous, untestable, or purely high-level buzzword requirements",
  ],
  handoffContract: {
    downstreamRoleId: "software-architect",
    description:
      "Delivers structured functional requirements, user stories, scope boundaries, and acceptance criteria to the Software Architect for technical design.",
    expectedSections: ["summary", "scope", "userStories", "functionalRequirements", "acceptanceCriteria"],
  },
  brandColor: "#f59e0b",
  icon: "Briefcase",
};

export const SOFTWARE_ARCHITECT_ROLE: RoleDefinition = {
  id: "software-architect",
  name: "Software Architect",
  description: "Designs system architecture, components, data flows, API contracts, and technology trade-offs.",
  purpose:
    "Translate product requirements and acceptance criteria into a robust, scalable, and maintainable software architecture with clear component boundaries, interfaces, and trade-off analyses.",
  responsibilities: [
    "Decompose product requirements into system components and service boundaries",
    "Define data schemas, storage models, and data flow pipelines",
    "Specify API contracts, interfaces, and communication protocols",
    "Conduct technical trade-off evaluations (e.g. latency vs consistency, build vs buy)",
    "Document architectural risks, security considerations, and mitigations",
  ],
  allowedResponsibilities: [
    "High-level and low-level system design",
    "Component and service decomposition",
    "API and protocol specification",
    "Data modeling and schema design",
    "Technical trade-off and risk analysis",
    "Non-functional requirements specification (scalability, availability, latency)",
  ],
  prohibitedResponsibilities: [
    "Modifying product scope or overriding business requirements without flagging",
    "Writing full production application code or implementing repository features",
    "Conducting final QA acceptance sign-off on own architecture",
    "Acting as product manager by redefining user business goals",
  ],
  instructions:
    "You are a Principal Software Architect. Your role is to translate product requirements into a robust, scalable system design. Define component boundaries, data models, API contracts, sequence diagrams or data flows, and document technical trade-offs and risks with mitigation strategies. Do NOT implement application production code or alter business requirements.",
  defaultAgentType: "claude-code",
  capabilities: [
    "system-design",
    "api-design",
    "data-modeling",
    "architectural-patterns",
    "tradeoff-analysis",
    "security-review",
    "component-decomposition",
  ],
  allowedTools: [
    "architecture-diagram-spec",
    "schema-validator",
    "read-only-code-inspection",
  ],
  inputContract: {
    type: "object",
    properties: {
      upstreamContext: { type: "array", description: "Upstream product manager requirements and specifications" },
      directInput: { type: "string", description: "Specific architectural focus or constraints" },
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      upstreamContext: { type: "array", description: "Upstream product manager requirements and specifications" },
      directInput: { type: "string", description: "Specific architectural focus or constraints" },
    },
  },
  outputContract: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Architectural overview and system approach" },
      components: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            responsibility: { type: "string" },
            interfaces: { type: "array", items: { type: "string" } },
            dependencies: { type: "array", items: { type: "string" } },
          },
          required: ["name", "responsibility"],
        },
      },
      dataModels: { type: "array", items: { type: "string" } },
      apiContracts: { type: "array", items: { type: "string" } },
      tradeoffs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            decision: { type: "string" },
            alternativesConsidered: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
          },
          required: ["decision", "rationale"],
        },
      },
      risksAndMitigations: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "components", "apiContracts", "tradeoffs"],
  },
  outputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Architectural overview" },
      decisions: { type: "array", items: { type: "string" }, description: "Key architectural decisions" },
      architecture: { type: "string", description: "Detailed system architecture and component structure" },
      risks: { type: "array", items: { type: "string" }, description: "Technical risks and mitigations" },
      nextSteps: { type: "array", items: { type: "string" }, description: "Recommended implementation phases" },
    },
    required: ["summary", "decisions", "architecture"],
  },
  acceptanceCriteria: [
    "Addresses all requirements and user stories from upstream Product Manager",
    "Clear component architecture, boundaries, interfaces, and data flows",
    "Explicit technical decisions with trade-off analysis and risk mitigations",
    "No production implementation source code is emitted",
  ],
  failureConditions: [
    "Writing full production application source code instead of architectural blueprints",
    "Ignoring upstream PM requirements or unilaterally dropping scope",
    "Omitting component boundaries, API contracts, or trade-off rationales",
    "Ignoring security, availability, or failure modes",
  ],
  handoffContract: {
    downstreamRoleId: "reviewer",
    description:
      "Delivers comprehensive architectural design, component models, API contracts, and trade-off rationales to the Reviewer for verification.",
    expectedSections: ["summary", "components", "dataModels", "apiContracts", "tradeoffs", "risksAndMitigations"],
  },
  brandColor: "#8b5cf6",
  icon: "Cpu",
};

export const REVIEWER_ROLE: RoleDefinition = {
  id: "reviewer",
  name: "Reviewer",
  description: "Audits specifications, system architecture, security, edge cases, and verifies acceptance criteria.",
  purpose:
    "Provide an independent, rigorous audit of product requirements and architectural designs, identifying defects, missing requirements, security risks, and issuing an actionable verdict.",
  responsibilities: [
    "Audit architecture and specifications against all upstream acceptance criteria",
    "Identify defects, ambiguities, security vulnerabilities, and scalability bottlenecks",
    "Evaluate defect severity (critical, major, minor) with objective evidence",
    "Deliver a definitive verdict (approved or changes_requested) with prioritized remediation guidance",
  ],
  allowedResponsibilities: [
    "Specification and architecture auditing",
    "Defect identification and severity classification",
    "Acceptance criteria verification",
    "Security, resiliency, and performance risk assessment",
    "Issuing final review verdict and remediation requirements",
  ],
  prohibitedResponsibilities: [
    "Silently fixing code or modifying architectural specifications directly",
    "Approving designs that fail acceptance criteria without explicit waivers",
    "Inventing new out-of-scope requirements not related to the original goal",
    "Issuing ambiguous or non-committal verdicts without clear action items",
  ],
  instructions:
    "You are a Senior Technical Reviewer and Quality Lead. Your role is to thoroughly audit the proposed product specifications and architectural designs. Verify that all acceptance criteria are met, identify security or operational vulnerabilities, inspect edge cases, and provide an actionable verdict with constructive recommendations. Do NOT silently fix code or alter designs yourself.",
  defaultAgentType: "claude-code",
  capabilities: [
    "architecture-review",
    "security-audit",
    "quality-assurance",
    "edge-case-analysis",
    "acceptance-verification",
    "severity-classification",
    "verdict-generation",
  ],
  allowedTools: [
    "compliance-checker",
    "audit-reporter",
    "read-only-inspection",
  ],
  inputContract: {
    type: "object",
    properties: {
      upstreamContext: { type: "array", description: "Upstream architecture and product requirements" },
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      upstreamContext: { type: "array", description: "Upstream architecture and product requirements" },
    },
  },
  outputContract: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Review overview and executive summary" },
      verdict: {
        type: "string",
        enum: ["approved", "changes_requested"],
        description: "Definitive audit verdict",
      },
      acceptanceCriteriaStatus: {
        type: "array",
        items: {
          type: "object",
          properties: {
            criterion: { type: "string" },
            status: { type: "string", "enum": ["met", "unmet", "partially_met"] },
            notes: { type: "string" },
          },
          required: ["criterion", "status"],
        },
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            severity: { type: "string", enum: ["critical", "major", "minor", "info"] },
            description: { type: "string" },
            evidence: { type: "string" },
            recommendation: { type: "string" },
          },
          required: ["severity", "description", "recommendation"],
        },
      },
      remediationPlan: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "verdict", "acceptanceCriteriaStatus", "findings"],
  },
  outputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Review summary" },
      findings: { type: "array", items: { type: "string" }, description: "Specific audit findings and observations" },
      verdict: {
        type: "string",
        enum: ["approved", "changes_requested"],
        description: "Overall audit verdict",
      },
      recommendations: { type: "array", items: { type: "string" }, description: "Actionable recommendations" },
    },
    required: ["summary", "findings", "verdict"],
  },
  acceptanceCriteria: [
    "Every upstream acceptance criterion is explicitly evaluated",
    "All identified defects include severity and objective evidence",
    "A definitive verdict (approved or changes_requested) is issued",
    "Prioritized remediation actions are provided for any unmet criteria or defects",
    "No silent fixes or code modifications are made",
  ],
  failureConditions: [
    "Silently implementing fixes instead of reviewing and reporting defects",
    "Giving an ambiguous verdict without explicit pass or changes_requested designation",
    "Failing to evaluate against upstream acceptance criteria",
    "Reporting defects without severity classification or evidence",
  ],
  handoffContract: {
    downstreamRoleId: null,
    description:
      "Delivers structured review audit, defect report, and verdict to the user and workflow orchestrator.",
    expectedSections: ["summary", "verdict", "acceptanceCriteriaStatus", "findings", "remediationPlan"],
  },
  brandColor: "#10b981",
  icon: "CheckSquare",
};

export const MANAGER_ROLE: RoleDefinition = {
  id: "manager",
  name: "Manager",
  description: "Decomposes high-level objectives, selects specialized roles, determines workflow phases, and defines stage contracts.",
  purpose:
    "Transform high-level user goals into structured, phased execution plans, selecting appropriate specialist roles (Product Manager, Software Architect, Reviewer) and defining stage contracts without implementing source code or technical blueprints directly.",
  responsibilities: [
    "Analyze user objectives, scope constraints, and domain requirements",
    "Decompose complex goals into sequential and parallel execution phases",
    "Select appropriate specialist roles matching the problem domain",
    "Define input and output handoff expectations between workflow stages",
    "Identify critical assumptions, dependencies, and high-level project risks",
    "Generate structured, actionable workflow plans for team execution",
  ],
  allowedResponsibilities: [
    "High-level goal decomposition and phase structuring",
    "Specialist role selection and assignment (PM, Software Architect, Reviewer)",
    "Workflow sequencing and dependency graph construction",
    "Handoff contract and expectation definition",
    "Project assumption and high-level risk identification",
    "Workflow plan generation and validation",
  ],
  prohibitedResponsibilities: [
    "Writing application source code, scripts, or runtime implementation logic",
    "Designing low-level technical software architectures, database schemas, or API implementation details",
    "Conducting final QA acceptance sign-off or issuing review verdicts directly",
    "Silently modifying or overriding Product Manager, Architect, or Reviewer role contracts",
    "Bypassing Harness execution, contract compilation, or validation boundaries",
    "Directly executing terminal commands, builds, or deployment scripts",
    "Directly manipulating runtime execution or overriding downstream role instructions",
  ],
  instructions:
    "You are an Engineering Manager and Delivery Lead. Your role is to understand the user's high-level goal, break it down into clear execution phases, select appropriate specialist roles (such as Product Manager, Software Architect, and Reviewer), and define structured handoff expectations, assumptions, and risks. Do NOT write production source code, design database schemas, or implement architectural blueprints yourself.",
  defaultAgentType: "claude-code",
  capabilities: [
    "goal-decomposition",
    "role-selection",
    "workflow-orchestration",
    "risk-assessment",
    "contract-definition",
    "phase-planning",
  ],
  allowedTools: [
    "workflow-planner",
    "goal-decomposer",
    "plan-validator",
  ],
  inputContract: {
    type: "object",
    properties: {
      goal: { type: "string", description: "High-level user goal or project objective" },
      constraints: { type: "array", items: { type: "string" }, description: "Optional project constraints" },
    },
    required: ["goal"],
  },
  inputSchema: {
    type: "object",
    properties: {
      goal: { type: "string", description: "High-level user goal or project objective" },
      constraints: { type: "array", items: { type: "string" }, description: "Optional project constraints" },
    },
    required: ["goal"],
  },
  outputContract: {
    type: "object",
    properties: {
      goal: { type: "string", description: "Original user goal" },
      workflowIntent: { type: "string", description: "Summary of workflow execution strategy" },
      selectedRoles: { type: "array", items: { type: "string" }, description: "List of selected role IDs in execution order" },
      assumptions: { type: "array", items: { type: "string" }, description: "Key assumptions identified" },
      risks: { type: "array", items: { type: "string" }, description: "Key project risks and considerations" },
    },
    required: ["goal", "workflowIntent", "selectedRoles"],
  },
  outputSchema: {
    type: "object",
    properties: {
      goal: { type: "string", description: "Original user goal" },
      workflowIntent: { type: "string", description: "Summary of workflow execution strategy" },
      selectedRoles: { type: "array", items: { type: "string" }, description: "List of selected role IDs in execution order" },
      assumptions: { type: "array", items: { type: "string" }, description: "Key assumptions identified" },
      risks: { type: "array", items: { type: "string" }, description: "Key project risks and considerations" },
    },
    required: ["goal", "workflowIntent", "selectedRoles"],
  },
  acceptanceCriteria: [
    "Decomposes user goal into clear logical execution phases",
    "Selects appropriate specialist roles matching the objective",
    "Specifies structured workflow intent without implementation code",
    "Identifies explicit assumptions and high-level project risks",
  ],
  failureConditions: [
    "Emits implementation source code, scripts, or technical database schemas",
    "Fails to select appropriate specialist roles matching the goal",
    "Omits workflow intent or risk analysis",
    "Attempts to override or bypass downstream role contracts",
  ],
  handoffContract: {
    downstreamRoleId: "product-manager",
    description:
      "Delivers structured goal breakdown, workflow intent, assumptions, and risks to downstream specialist roles.",
    expectedSections: ["goal", "workflowIntent", "selectedRoles", "assumptions", "risks"],
  },
  brandColor: "#6366f1",
  icon: "Compass",
};

/** Shipped default roles available out-of-the-box. */
export const BUILTIN_ROLES: readonly RoleDefinition[] = [
  MANAGER_ROLE,
  PRODUCT_MANAGER_ROLE,
  SOFTWARE_ARCHITECT_ROLE,
  REVIEWER_ROLE,
] as const;

const roleRegistry = new Map<string, RoleDefinition>();

function seedRegistry(): void {
  roleRegistry.clear();
  for (const role of BUILTIN_ROLES) {
    roleRegistry.set(role.id, role);
  }
}

seedRegistry();

/**
 * Looks up a role definition by ID.
 *
 * @example
 * Input:
 *   getRoleDefinition("software-architect")
 * Output:
 *   RoleDefinition object for Software Architect
 */
export function getRoleDefinition(roleId: string): RoleDefinition | undefined {
  if (!roleId) return undefined;
  return roleRegistry.get(roleId.trim().toLowerCase());
}

/**
 * Returns all currently registered role definitions.
 *
 * @example
 * Input:
 *   listRoleDefinitions()
 * Output:
 *   Array of RoleDefinition objects
 */
export function listRoleDefinitions(): RoleDefinition[] {
  return Array.from(roleRegistry.values());
}

/**
 * Registers a new or updated role definition at runtime.
 *
 * @example
 * Input:
 *   registerRoleDefinition(customRole)
 */
export function registerRoleDefinition(role: RoleDefinition): void {
  roleRegistry.set(role.id.trim().toLowerCase(), role);
}

/**
 * Test-only: Resets registry back to default built-in roles.
 */
export function resetRoleRegistryForTests(): void {
  seedRegistry();
}
