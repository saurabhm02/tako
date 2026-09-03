import { describe, expect, test } from "bun:test";
import { validateWorkflowName } from "./WorkflowSwitcher";
import type { WorkflowSummary } from "../../shared/types";

function wf(id: string, name: string): WorkflowSummary {
  return { id, name, updatedAt: 0 };
}

describe("validateWorkflowName", () => {
  test("an empty or whitespace-only name is rejected with a clear reason", () => {
    expect(validateWorkflowName("", [], "new", "active-id")).toBe("Enter a name.");
    expect(validateWorkflowName("   ", [], "new", "active-id")).toBe("Enter a name.");
  });

  test("a genuinely unique name passes", () => {
    const workflows = [wf("a", "Backend"), wf("b", "Frontend")];
    expect(validateWorkflowName("Research", workflows, "new", "a")).toBeNull();
  });

  test("a duplicate name (case-insensitive) is rejected with a clear reason naming the collision", () => {
    const workflows = [wf("a", "Backend Review")];
    expect(validateWorkflowName("backend review", workflows, "new", "a")).toBe('A workflow named "backend review" already exists.');
  });

  test("Save As colliding with the source workflow's own name is still rejected — Save As always targets a NEW id, so the active-workflow exemption never applies to it", () => {
    const workflows = [wf("a", "Backend Review")];
    expect(validateWorkflowName("Backend Review", workflows, "save-as", "a")).not.toBeNull();
  });

  test("renaming a workflow to its own current name is not flagged as a duplicate of itself", () => {
    const workflows = [wf("a", "Backend Review"), wf("b", "Frontend")];
    expect(validateWorkflowName("Backend Review", workflows, "rename", "a")).toBeNull();
  });

  test("renaming a workflow to ANOTHER workflow's name is still rejected", () => {
    const workflows = [wf("a", "Backend Review"), wf("b", "Frontend")];
    expect(validateWorkflowName("Frontend", workflows, "rename", "a")).not.toBeNull();
  });

  test("leading/trailing whitespace is trimmed before comparing", () => {
    const workflows = [wf("a", "Backend Review")];
    expect(validateWorkflowName("  Backend Review  ", workflows, "new", "a")).not.toBeNull();
  });
});
