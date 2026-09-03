import { beforeEach, describe, expect, test } from "bun:test";
import { closeDatabaseForTests, initDatabase } from "./db";
import { getOrCreateCurrentRun, resetCurrentRunForTests } from "./runsRepo";
import { ensureNodeExists, ensureWorkflowExists } from "./workflowsRepo";
import { getCodeChangeDetail, insertCodeChange, listCodeChangeSummariesForRun } from "./codeChangesRepo";
import { DEFAULT_WORKFLOW_ID } from "../../shared/types";
import type { FileChange } from "../git/codeChanges";

function makeNode(id: string, name: string) {
  ensureWorkflowExists(DEFAULT_WORKFLOW_ID, "My Workflow");
  ensureNodeExists({
    id,
    workflowId: DEFAULT_WORKFLOW_ID,
    name,
    kind: "agent",
    agentType: "claude-code",
    adapterKind: "terminal",
    workingDirectory: null,
    config: {},
    position: { x: 0, y: 0 },
  });
}

const oneFile: FileChange[] = [{ path: "src/auth/login.ts", oldPath: null, insertions: 32, deletions: 8, binary: false, status: "modified" }];

beforeEach(() => {
  closeDatabaseForTests();
  initDatabase(":memory:");
  resetCurrentRunForTests();
});

describe("insertCodeChange — returns the stored summary for live broadcasting", () => {
  test("the returned summary matches what's actually persisted", () => {
    makeNode("apollo-id", "Apollo");
    const runId = getOrCreateCurrentRun();

    const summary = insertCodeChange({
      runId,
      nodeId: "apollo-id",
      agentType: "claude-code",
      workingDirectory: "/tmp/repo",
      beforeTree: "abc",
      afterTree: "def",
      files: oneFile,
      insertions: 32,
      deletions: 8,
      diffText: "diff --git a/src/auth/login.ts b/src/auth/login.ts\n+new line\n-old line\n",
      truncated: false,
      concurrentRisk: false,
    });

    expect(summary).toMatchObject({ nodeId: "apollo-id", agentType: "claude-code", filesChanged: 1, insertions: 32, deletions: 8, truncated: false, concurrentRisk: false });
    expect(typeof summary.id).toBe("string");
    expect(typeof summary.createdAt).toBe("number");

    const stored = listCodeChangeSummariesForRun(runId);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(summary.id); // the returned row IS the persisted row, not a separate guess
  });

  test("the diff detail is fetchable by the returned id, matching exactly what was inserted", () => {
    makeNode("apollo-id", "Apollo");
    const runId = getOrCreateCurrentRun();
    const diffText = "diff --git a/src/auth/login.ts b/src/auth/login.ts\n+new line\n-old line\n";

    const summary = insertCodeChange({
      runId,
      nodeId: "apollo-id",
      agentType: "claude-code",
      workingDirectory: "/tmp/repo",
      beforeTree: "abc",
      afterTree: "def",
      files: oneFile,
      insertions: 32,
      deletions: 8,
      diffText,
      truncated: false,
      concurrentRisk: false,
    });

    const detail = getCodeChangeDetail(summary.id);
    expect(detail).not.toBeNull();
    expect(detail!.diffText).toBe(diffText);
    expect(detail!.files).toEqual(oneFile);
  });
});

describe("listCodeChangeSummariesForRun — includes the node's real name", () => {
  test("nodeName comes from the node's own name, not its agent type", () => {
    makeNode("apollo-id", "Apollo");
    const runId = getOrCreateCurrentRun();
    insertCodeChange({
      runId,
      nodeId: "apollo-id",
      agentType: "claude-code",
      workingDirectory: "/tmp/repo",
      beforeTree: "a",
      afterTree: "b",
      files: oneFile,
      insertions: 32,
      deletions: 8,
      diffText: "diff --git a/x b/x\n",
      truncated: false,
      concurrentRisk: false,
    });

    const [row] = listCodeChangeSummariesForRun(runId);
    expect(row.nodeName).toBe("Apollo");
    expect(row.agentType).toBe("claude-code");
  });

  test("two nodes with the same agent type still get their own distinct names", () => {
    makeNode("n1", "Backend Reviewer");
    makeNode("n2", "Frontend Reviewer");
    const runId = getOrCreateCurrentRun();
    for (const nodeId of ["n1", "n2"]) {
      insertCodeChange({
        runId,
        nodeId,
        agentType: "claude-code",
        workingDirectory: "/tmp/repo",
        beforeTree: "a",
        afterTree: "b",
        files: oneFile,
        insertions: 1,
        deletions: 1,
        diffText: "diff --git a/x b/x\n",
        truncated: false,
        concurrentRisk: false,
      });
    }

    const rows = listCodeChangeSummariesForRun(runId);
    const names = rows.map((r) => r.nodeName).sort();
    expect(names).toEqual(["Backend Reviewer", "Frontend Reviewer"]);
  });
});
