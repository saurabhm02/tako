import { describe, expect, it } from "bun:test";
import {
  DeterministicManagerPlanner,
  classifyGoal,
  generateManagerWorkflow,
  type ManagerPlanner,
  type ManagerRequest,
} from "./manager";
import {
  MANAGER_ROLE,
  PRODUCT_MANAGER_ROLE,
  SOFTWARE_ARCHITECT_ROLE,
  REVIEWER_ROLE,
  getRoleDefinition,
} from "./roles";
import { prepareExecution } from "./harness";
import { validateWorkflow } from "./workflowValidation";

describe("Manager Brain & Deterministic Team Workflow Generation", () => {
  const planner = new DeterministicManagerPlanner();

  // =========================================================================
  // 1. MANAGER ROLE DEFINITION & CONTRACT
  // =========================================================================
  describe("Manager Role Contract", () => {
    it("is registered as a core built-in role with valid ID and metadata", () => {
      const def = getRoleDefinition("manager");
      expect(def).toBeDefined();
      expect(def?.id).toBe("manager");
      expect(def?.name).toBe("Manager");
      expect(def?.defaultAgentType).toBe("claude-code");
      expect(def?.brandColor).toBeDefined();
    });

    it("defines clear planning purpose and allowed responsibilities", () => {
      expect(MANAGER_ROLE.purpose).toContain("Transform high-level user goals into structured");
      expect(MANAGER_ROLE.allowedResponsibilities).toContain(
        "High-level goal decomposition and phase structuring",
      );
      expect(MANAGER_ROLE.allowedResponsibilities).toContain(
        "Specialist role selection and assignment (PM, Software Architect, Reviewer)",
      );
      expect(MANAGER_ROLE.allowedResponsibilities).toContain(
        "Workflow sequencing and dependency graph construction",
      );
      expect(MANAGER_ROLE.allowedResponsibilities).toContain(
        "Project assumption and high-level risk identification",
      );
    });

    it("strictly prohibits implementation, database design, and overriding role contracts", () => {
      expect(MANAGER_ROLE.prohibitedResponsibilities).toContain(
        "Writing application source code, scripts, or runtime implementation logic",
      );
      expect(MANAGER_ROLE.prohibitedResponsibilities).toContain(
        "Designing low-level technical software architectures, database schemas, or API implementation details",
      );
      expect(MANAGER_ROLE.prohibitedResponsibilities).toContain(
        "Silently modifying or overriding Product Manager, Architect, or Reviewer role contracts",
      );
      expect(MANAGER_ROLE.prohibitedResponsibilities).toContain(
        "Bypassing Harness execution, contract compilation, or validation boundaries",
      );
      expect(MANAGER_ROLE.prohibitedResponsibilities).toContain(
        "Directly manipulating runtime execution or overriding downstream role instructions",
      );
    });

    it("specifies explicit acceptance criteria and failure conditions", () => {
      expect(MANAGER_ROLE.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
      expect(MANAGER_ROLE.failureConditions.length).toBeGreaterThanOrEqual(3);
      expect(MANAGER_ROLE.failureConditions).toContain(
        "Emits implementation source code, scripts, or technical database schemas",
      );
      expect(MANAGER_ROLE.failureConditions).toContain(
        "Attempts to override or bypass downstream role contracts",
      );
    });

    it("defines a structured handoff contract targeting downstream specialist roles", () => {
      expect(MANAGER_ROLE.handoffContract).toBeDefined();
      expect(MANAGER_ROLE.handoffContract.downstreamRoleId).toBe("product-manager");
      expect(MANAGER_ROLE.handoffContract.expectedSections).toContain("workflowIntent");
      expect(MANAGER_ROLE.handoffContract.expectedSections).toContain("selectedRoles");
      expect(MANAGER_ROLE.handoffContract.expectedSections).toContain("assumptions");
      expect(MANAGER_ROLE.handoffContract.expectedSections).toContain("risks");
    });

    it("compiles Manager execution contract in prepareExecution", () => {
      const prepared = prepareExecution(
        {
          roleId: "manager",
          taskInstructions: "Plan a payment gateway integration workflow.",
        },
        { directInput: "Plan a payment gateway integration workflow." },
      );

      expect(prepared.systemInstructions).toContain("[ROLE: Manager]");
      expect(prepared.systemInstructions).toContain("[ALLOWED RESPONSIBILITIES]");
      expect(prepared.systemInstructions).toContain("[PROHIBITED ACTIONS & BOUNDARIES]");
      expect(prepared.systemInstructions).toContain("MUST NOT: Writing application source code");
      expect(prepared.systemInstructions).toContain("[FAILURE CONDITIONS (REJECT IF)]");
      expect(prepared.systemInstructions).toContain("[HANDOFF CONTRACT]");
      expect(prepared.outputSchema).toBeDefined();
      expect(prepared.metadata.roleId).toBe("manager");
    });
  });

  // =========================================================================
  // 2. DETERMINISTIC ROLE SELECTION & CLASSIFICATION
  // =========================================================================
  describe("Deterministic Role Selection", () => {
    it("selects PM + Architect + Reviewer for product and build requests", () => {
      const queries = [
        "Build a SaaS application for managing invoices.",
        "Create an e-commerce marketplace for handmade goods.",
        "Develop a real-time collaborative whiteboard app.",
        "Implement a distributed file storage service.",
      ];

      for (const query of queries) {
        const res = classifyGoal(query);
        expect(res.category).toBe("build");
        expect(res.roles).toEqual(["manager", "product-manager", "software-architect", "reviewer"]);
        expect(res.summary).toContain("4-stage delivery workflow");
      }
    });

    it("selects PM + Reviewer for research and feasibility requests", () => {
      const queries = [
        "Research competitor pricing models for B2B analytics tools.",
        "Investigate market feasibility for decentralized identity.",
        "Explore LLM orchestration framework benchmarks.",
        "Study user onboarding friction patterns.",
      ];

      for (const query of queries) {
        const res = classifyGoal(query);
        expect(res.category).toBe("research");
        expect(res.roles).toEqual(["manager", "product-manager", "reviewer"]);
        expect(res.summary).toContain("3-stage research workflow");
      }
    });

    it("selects Architect + Reviewer for architecture-focused requests", () => {
      const queries = [
        "Design system architecture for high-throughput WebSocket message broker.",
        "Plan database schema and partitioning strategy for time-series metrics.",
        "Specify microservices communication and gRPC API contracts.",
        "Evaluate infrastructure topology for multi-region active-active deployment.",
      ];

      for (const query of queries) {
        const res = classifyGoal(query);
        expect(res.category).toBe("architecture");
        expect(res.roles).toEqual(["manager", "software-architect", "reviewer"]);
        expect(res.summary).toContain("3-stage architecture workflow");
      }
    });

    it("selects PM + Reviewer for requirements and PRD-focused requests", () => {
      const queries = [
        "Write functional requirements and user stories for user onboarding.",
        "Create a PRD and scope definition for dark mode support.",
        "Define specifications and acceptance criteria for checkout flow.",
      ];

      for (const query of queries) {
        const res = classifyGoal(query);
        expect(res.category).toBe("requirements");
        expect(res.roles).toEqual(["manager", "product-manager", "reviewer"]);
        expect(res.summary).toContain("3-stage requirements workflow");
      }
    });

    it("falls back to full 4-stage team for ambiguous or uncertain requests", () => {
      const queries = [
        "Improve customer retention.",
        "Something with notifications.",
        "Automate reports.",
      ];

      for (const query of queries) {
        const res = classifyGoal(query);
        expect(res.roles).toEqual(["manager", "product-manager", "software-architect", "reviewer"]);
      }
    });
  });

  // =========================================================================
  // 3. CANVAS WORKFLOW GENERATION
  // =========================================================================
  describe("Workflow Generation & Canvas Layout", () => {
    it("generates valid nodes, horizontal positions, and sequential connections", () => {
      const request: ManagerRequest = {
        goal: "Build a subscription management platform.",
        preferredAgent: "claude-code",
        workingDirectory: "/workspace/billing",
      };

      const plan = planner.createPlan(request);

      expect(plan.goal).toBe("Build a subscription management platform.");
      expect(plan.selectedRoles).toEqual(["manager", "product-manager", "software-architect", "reviewer"]);
      expect(plan.workflowNodes.length).toBe(4);
      expect(plan.workflowConnections.length).toBe(3);

      // Verify node attributes
      const [managerNode, pmNode, archNode, revNode] = plan.workflowNodes;

      expect(managerNode.name).toBe("Manager");
      expect(managerNode.roleId).toBe("manager");
      expect(managerNode.workingDirectory).toBe("/workspace/billing");
      expect(managerNode.position.x).toBe(80);
      expect(managerNode.position.y).toBe(140);

      expect(pmNode.name).toBe("Product Manager");
      expect(pmNode.roleId).toBe("product-manager");
      expect(pmNode.position.x).toBe(720);

      expect(archNode.name).toBe("Software Architect");
      expect(archNode.roleId).toBe("software-architect");
      expect(archNode.position.x).toBe(1360);

      expect(revNode.name).toBe("Reviewer");
      expect(revNode.roleId).toBe("reviewer");
      expect(revNode.position.x).toBe(2000);

      // Verify connection links
      const [conn1, conn2, conn3] = plan.workflowConnections;
      expect(conn1.fromNodeId).toBe(managerNode.id);
      expect(conn1.toNodeId).toBe(pmNode.id);

      expect(conn2.fromNodeId).toBe(pmNode.id);
      expect(conn2.toNodeId).toBe(archNode.id);

      expect(conn3.fromNodeId).toBe(archNode.id);
      expect(conn3.toNodeId).toBe(revNode.id);
    });

    it("generates a fully validated WorkflowSnapshot passing validateWorkflow", () => {
      const snapshot = generateManagerWorkflow({
        goal: "Build a URL shortener service.",
        name: "URL Shortener Workflow",
      });

      expect(snapshot.id).toBeDefined();
      expect(snapshot.name).toBe("URL Shortener Workflow");
      expect(snapshot.workflowType).toBe("team");

      const validation = validateWorkflow(snapshot);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it("rejects empty or whitespace goals with structured error", () => {
      expect(() => generateManagerWorkflow({ goal: "" })).toThrow("goal is required");
      expect(() => generateManagerWorkflow({ goal: "   " })).toThrow("goal is required");
    });

    it("does not expose internal hidden chain-of-thought in reasoningSummary", () => {
      const plan = planner.createPlan({ goal: "Build an inventory tracker" });

      expect(plan.reasoningSummary).toBeDefined();
      expect(plan.reasoningSummary).not.toContain("<thought>");
      expect(plan.reasoningSummary).not.toContain("chain-of-thought");
      expect(plan.reasoningSummary).toContain("Created a 4-stage");
    });

    it("generates fresh unique snapshots on repeated calls without state leakage", () => {
      const snap1 = generateManagerWorkflow({ goal: "Build service A" });
      const snap2 = generateManagerWorkflow({ goal: "Build service A" });

      expect(snap1.id).not.toBe(snap2.id);
      expect(snap1.nodes[0].id).not.toBe(snap2.nodes[0].id);
      expect(snap1.connections[0].id).not.toBe(snap2.connections[0].id);
    });

    it("allows plugging in custom ManagerPlanner implementations", () => {
      const customPlanner: ManagerPlanner = {
        createPlan(req: ManagerRequest) {
          return {
            goal: req.goal,
            reasoningSummary: "Custom 2-stage workflow",
            selectedRoles: ["manager", "reviewer"],
            workflowNodes: [
              {
                id: "custom-mgr",
                name: "Manager",
                kind: "agent",
                agentType: "claude-code",
                adapterKind: "terminal",
                workingDirectory: null,
                roleId: "manager",
                config: {},
                position: { x: 0, y: 0 },
              },
              {
                id: "custom-rev",
                name: "Reviewer",
                kind: "agent",
                agentType: "claude-code",
                adapterKind: "terminal",
                workingDirectory: null,
                roleId: "reviewer",
                config: {},
                position: { x: 600, y: 0 },
              },
            ],
            workflowConnections: [
              {
                id: "c1",
                fromNodeId: "custom-mgr",
                toNodeId: "custom-rev",
                autoApprove: true,
              },
            ],
            assumptions: [],
            risks: [],
          };
        },
      };

      const customSnap = generateManagerWorkflow({ goal: "Custom initiative" }, customPlanner);
      expect(customSnap.nodes.length).toBe(2);
      expect(customSnap.nodes[0].id).toBe("custom-mgr");
      expect(customSnap.nodes[1].id).toBe("custom-rev");
    });
  });
});
