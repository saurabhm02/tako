import { describe, expect, it } from "bun:test";
import {
  BUILTIN_ROLES,
  PRODUCT_MANAGER_ROLE,
  REVIEWER_ROLE,
  SOFTWARE_ARCHITECT_ROLE,
  getRoleDefinition,
  listRoleDefinitions,
  registerRoleDefinition,
  type RoleDefinition,
} from "./roles";

describe("Production-Grade Role Definitions & Execution Contracts", () => {
  it("provides exactly the 4 core built-in roles: manager, product-manager, software-architect, reviewer", () => {
    const roles = listRoleDefinitions();
    expect(roles.length).toBe(4);
    expect(roles.map((r) => r.id).sort()).toEqual(["manager", "product-manager", "reviewer", "software-architect"]);
  });

  describe("Product Manager Contract", () => {
    const pm = PRODUCT_MANAGER_ROLE;

    it("defines clear purpose and functional responsibilities", () => {
      expect(pm.id).toBe("product-manager");
      expect(pm.name).toBe("Product Manager");
      expect(pm.purpose).toContain("functional specifications");
      expect(pm.purpose).toContain("acceptance criteria");
      expect(pm.responsibilities.length).toBeGreaterThanOrEqual(4);
      expect(pm.allowedResponsibilities).toContain("Requirements elicitation and functional specification");
      expect(pm.allowedResponsibilities).toContain("Scope definition and explicit non-goals delineation");
    });

    it("explicitly prohibits code implementation and technical architecture design", () => {
      const prohibited = pm.prohibitedResponsibilities.join(" ").toLowerCase();
      expect(prohibited).toContain("source code");
      expect(prohibited).toContain("architecture");
      expect(pm.prohibitedResponsibilities.some((p) => p.includes("Implementing application source code"))).toBe(true);
      expect(pm.prohibitedResponsibilities.some((p) => p.includes("Designing technical software architecture"))).toBe(true);
    });

    it("specifies explicit failure conditions", () => {
      expect(pm.failureConditions.length).toBeGreaterThanOrEqual(3);
      const failureText = pm.failureConditions.join(" ").toLowerCase();
      expect(failureText).toContain("source code");
      expect(failureText).toContain("non-goals");
    });

    it("defines a handoff contract targeted at the Software Architect", () => {
      expect(pm.handoffContract.downstreamRoleId).toBe("software-architect");
      expect(pm.handoffContract.description).toContain("Software Architect");
      expect(pm.handoffContract.expectedSections).toContain("userStories");
      expect(pm.handoffContract.expectedSections).toContain("acceptanceCriteria");
    });

    it("has valid input and output contracts", () => {
      expect(pm.inputContract).toBeDefined();
      expect(pm.outputContract).toBeDefined();
      expect((pm.outputContract?.required as string[])).toContain("scope");
      expect((pm.outputContract?.required as string[])).toContain("userStories");
    });
  });

  describe("Software Architect Contract", () => {
    const arch = SOFTWARE_ARCHITECT_ROLE;

    it("defines clear purpose and architectural responsibilities", () => {
      expect(arch.id).toBe("software-architect");
      expect(arch.name).toBe("Software Architect");
      expect(arch.purpose).toContain("software architecture");
      expect(arch.purpose).toContain("component boundaries");
      expect(arch.allowedResponsibilities).toContain("Component and service decomposition");
      expect(arch.allowedResponsibilities).toContain("API and protocol specification");
      expect(arch.allowedResponsibilities).toContain("Technical trade-off and risk analysis");
    });

    it("explicitly prohibits altering product scope and writing production implementation code", () => {
      const prohibited = arch.prohibitedResponsibilities.join(" ").toLowerCase();
      expect(prohibited).toContain("production application code");
      expect(prohibited).toContain("product scope");
      expect(arch.prohibitedResponsibilities.some((p) => p.includes("Writing full production application code"))).toBe(true);
      expect(arch.prohibitedResponsibilities.some((p) => p.includes("Modifying product scope"))).toBe(true);
    });

    it("specifies explicit failure conditions", () => {
      expect(arch.failureConditions.length).toBeGreaterThanOrEqual(3);
      const failureText = arch.failureConditions.join(" ").toLowerCase();
      expect(failureText).toContain("production application source code");
      expect(failureText).toContain("upstream pm requirements");
    });

    it("defines a handoff contract targeted at the Reviewer", () => {
      expect(arch.handoffContract.downstreamRoleId).toBe("reviewer");
      expect(arch.handoffContract.description).toContain("Reviewer");
      expect(arch.handoffContract.expectedSections).toContain("components");
      expect(arch.handoffContract.expectedSections).toContain("tradeoffs");
    });

    it("has valid input and output contracts", () => {
      expect(arch.inputContract).toBeDefined();
      expect(arch.outputContract).toBeDefined();
      expect((arch.outputContract?.required as string[])).toContain("components");
      expect((arch.outputContract?.required as string[])).toContain("apiContracts");
      expect((arch.outputContract?.required as string[])).toContain("tradeoffs");
    });
  });

  describe("Reviewer Contract", () => {
    const rev = REVIEWER_ROLE;

    it("defines clear purpose and audit responsibilities", () => {
      expect(rev.id).toBe("reviewer");
      expect(rev.name).toBe("Reviewer");
      expect(rev.purpose).toContain("audit of product requirements and architectural designs");
      expect(rev.allowedResponsibilities).toContain("Defect identification and severity classification");
      expect(rev.allowedResponsibilities).toContain("Acceptance criteria verification");
      expect(rev.allowedResponsibilities).toContain("Issuing final review verdict and remediation requirements");
    });

    it("explicitly prohibits silently implementing code fixes or rewriting specifications", () => {
      const prohibited = rev.prohibitedResponsibilities.join(" ").toLowerCase();
      expect(prohibited).toContain("silently fixing code");
      expect(prohibited).toContain("ambiguous");
      expect(rev.prohibitedResponsibilities.some((p) => p.includes("Silently fixing code"))).toBe(true);
      expect(rev.prohibitedResponsibilities.some((p) => p.includes("Approving designs that fail acceptance criteria"))).toBe(true);
    });

    it("specifies explicit failure conditions", () => {
      expect(rev.failureConditions.length).toBeGreaterThanOrEqual(3);
      const failureText = rev.failureConditions.join(" ").toLowerCase();
      expect(failureText).toContain("silently implementing fixes");
      expect(failureText).toContain("ambiguous");
    });

    it("defines terminal delivery in handoff contract", () => {
      expect(rev.handoffContract.downstreamRoleId).toBeNull();
      expect(rev.handoffContract.description).toContain("user and workflow orchestrator");
      expect(rev.handoffContract.expectedSections).toContain("verdict");
      expect(rev.handoffContract.expectedSections).toContain("findings");
    });

    it("has valid input and output contracts requiring structured verdict and findings", () => {
      expect(rev.inputContract).toBeDefined();
      expect(rev.outputContract).toBeDefined();
      expect((rev.outputContract?.required as string[])).toContain("verdict");
      expect((rev.outputContract?.required as string[])).toContain("findings");
      expect((rev.outputContract?.required as string[])).toContain("acceptanceCriteriaStatus");
    });
  });

  describe("Role Boundary Isolation & Non-Overlap", () => {
    it("strictly separates concerns between PM, Architect, and Reviewer", () => {
      // Only PM owns user stories & scope non-goals
      expect(PRODUCT_MANAGER_ROLE.capabilities).toContain("user-stories");
      expect(SOFTWARE_ARCHITECT_ROLE.capabilities).not.toContain("user-stories");
      expect(REVIEWER_ROLE.capabilities).not.toContain("user-stories");

      // Only Architect owns trade-off analysis & system design
      expect(SOFTWARE_ARCHITECT_ROLE.capabilities).toContain("tradeoff-analysis");
      expect(PRODUCT_MANAGER_ROLE.capabilities).not.toContain("tradeoff-analysis");
      expect(REVIEWER_ROLE.capabilities).not.toContain("tradeoff-analysis");

      // Only Reviewer owns verdict generation & severity classification
      expect(REVIEWER_ROLE.capabilities).toContain("verdict-generation");
      expect(PRODUCT_MANAGER_ROLE.capabilities).not.toContain("verdict-generation");
      expect(SOFTWARE_ARCHITECT_ROLE.capabilities).not.toContain("verdict-generation");

      // All 3 roles strictly prohibit silent code implementation
      expect(PRODUCT_MANAGER_ROLE.prohibitedResponsibilities.some((p) => p.toLowerCase().includes("code"))).toBe(true);
      expect(SOFTWARE_ARCHITECT_ROLE.prohibitedResponsibilities.some((p) => p.toLowerCase().includes("code"))).toBe(true);
      expect(REVIEWER_ROLE.prohibitedResponsibilities.some((p) => p.toLowerCase().includes("code") || p.toLowerCase().includes("fixing"))).toBe(true);
    });
  });

  describe("Custom Role Registration & Registry Safety", () => {
    it("allows registering custom role definitions with full contract", () => {
      const customRole: RoleDefinition = {
        id: "security-auditor",
        name: "Security Auditor",
        description: "Specialist in threat modeling and cryptographic audits",
        purpose: "Perform static security reviews and penetration threat modeling",
        responsibilities: ["Review cryptographic primitives", "Identify injection vulnerabilities"],
        allowedResponsibilities: ["Security analysis", "Threat modeling"],
        prohibitedResponsibilities: ["Deploying changes to production", "Disabling audit logging"],
        instructions: "You are a Security Auditor. Inspect system architecture for CVEs.",
        capabilities: ["threat-modeling", "cve-audit"],
        allowedTools: ["static-analyzer"],
        defaultAgentType: "claude-code",
        acceptanceCriteria: ["All OWASP top 10 vectors reviewed"],
        failureConditions: ["Passing unchecked external input"],
        handoffContract: {
          downstreamRoleId: null,
          description: "Deliver security audit report",
        },
      };

      registerRoleDefinition(customRole);

      const fetched = getRoleDefinition("security-auditor");
      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe("security-auditor");
      expect(fetched?.purpose).toContain("threat modeling");
      expect(fetched?.prohibitedResponsibilities).toContain("Deploying changes to production");
    });

    it("returns undefined for unknown role IDs", () => {
      expect(getRoleDefinition("unknown-role")).toBeUndefined();
      expect(getRoleDefinition("")).toBeUndefined();
    });
  });
});
