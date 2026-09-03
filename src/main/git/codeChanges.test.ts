import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diffTrees, isGitRepo, snapshotTree } from "./codeChanges";

function run(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (err) => (err ? reject(err) : resolve()));
  });
}

let repoDir: string;

beforeEach(async () => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-code-changes-test-"));
  await run(repoDir, ["init", "-q"]);
  await run(repoDir, ["config", "user.email", "test@example.com"]);
  await run(repoDir, ["config", "user.name", "Test"]);
});

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

function write(file: string, content: string): void {
  fs.writeFileSync(path.join(repoDir, file), content);
}

describe("isGitRepo", () => {
  test("a real git repo is detected", async () => {
    expect(await isGitRepo(repoDir)).toBe(true);
  });

  test("a plain directory with no .git is not a repo", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "tako-non-git-test-"));
    expect(await isGitRepo(plain)).toBe(false);
    fs.rmSync(plain, { recursive: true, force: true });
  });
});

describe("snapshotTree", () => {
  test("never touches the real index or working tree", async () => {
    write("a.txt", "hello");
    await snapshotTree(repoDir);

    // A real `git add -A` would have staged a.txt — the shadow index must
    // never have touched the real one.
    const status = await new Promise<string>((resolve) => {
      execFile("git", ["status", "--porcelain"], { cwd: repoDir }, (_err, stdout) => resolve(stdout));
    });
    expect(status.trim()).toBe("?? a.txt"); // still untracked, never staged

    const staged = await new Promise<string>((resolve) => {
      execFile("git", ["diff", "--cached", "--name-only"], { cwd: repoDir }, (_err, stdout) => resolve(stdout));
    });
    expect(staged.trim()).toBe(""); // nothing in the real index
  });

  test("the same unchanged tree snapshots to the same id", async () => {
    write("a.txt", "hello");
    const first = await snapshotTree(repoDir);
    const second = await snapshotTree(repoDir);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  test("a non-git directory returns null", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "tako-non-git-test-"));
    expect(await snapshotTree(plain)).toBeNull();
    fs.rmSync(plain, { recursive: true, force: true });
  });
});

describe("diffTrees", () => {
  test("identical trees produce no files", async () => {
    write("a.txt", "hello");
    const sha = await snapshotTree(repoDir);
    const diff = await diffTrees(repoDir, sha!, sha!);
    expect(diff.files).toEqual([]);
  });

  test("a new file is reported as added, with the real content in the diff", async () => {
    const before = await snapshotTree(repoDir);
    write("new.txt", "line one\n");
    const after = await snapshotTree(repoDir);

    const diff = await diffTrees(repoDir, before!, after!);
    expect(diff.files).toEqual([{ path: "new.txt", oldPath: null, insertions: 1, deletions: 0, binary: false, status: "added" }]);
    expect(diff.diffText).toContain("+line one");
  });

  // The core regression: pre-existing dirty changes must never be
  // attributed to the agent's turn.
  test("changes already dirty before the turn started never appear in the diff", async () => {
    write("already-dirty.txt", "pre-existing uncommitted work");
    const before = await snapshotTree(repoDir); // captures the dirty file as the baseline

    write("agent-made.txt", "the agent's own new file");
    const after = await snapshotTree(repoDir);

    const diff = await diffTrees(repoDir, before!, after!);
    expect(diff.files.map((f) => f.path)).toEqual(["agent-made.txt"]);
  });

  test("a modified file is reported as modified", async () => {
    write("a.txt", "original\n");
    const before = await snapshotTree(repoDir);
    write("a.txt", "changed\n");
    const after = await snapshotTree(repoDir);

    const diff = await diffTrees(repoDir, before!, after!);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({ path: "a.txt", status: "modified" });
  });

  test("a deleted file is reported as deleted", async () => {
    write("a.txt", "will be removed\n");
    const before = await snapshotTree(repoDir);
    fs.rmSync(path.join(repoDir, "a.txt"));
    const after = await snapshotTree(repoDir);

    const diff = await diffTrees(repoDir, before!, after!);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({ path: "a.txt", status: "deleted" });
  });

  test("a renamed file (same content, new path) is detected with -M", async () => {
    const content = "a".repeat(200) + "\n"; // long enough for git's similarity heuristic to be unambiguous
    write("old-name.txt", content);
    const before = await snapshotTree(repoDir);
    fs.renameSync(path.join(repoDir, "old-name.txt"), path.join(repoDir, "new-name.txt"));
    const after = await snapshotTree(repoDir);

    const diff = await diffTrees(repoDir, before!, after!);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({ path: "new-name.txt", oldPath: "old-name.txt", status: "renamed" });
  });

  test("a binary file change is flagged binary with no line counts", async () => {
    const before = await snapshotTree(repoDir);
    fs.writeFileSync(path.join(repoDir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    const after = await snapshotTree(repoDir);

    const diff = await diffTrees(repoDir, before!, after!);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({ path: "image.png", binary: true, insertions: 0, deletions: 0 });
    expect(diff.diffText).toContain("Binary files");
  });

  test(
    "a very large diff is capped and marked truncated",
    async () => {
      const before = await snapshotTree(repoDir);
      write("huge.txt", "x\n".repeat(150_000)); // well past the 200K-char cap
      const after = await snapshotTree(repoDir);

      const diff = await diffTrees(repoDir, before!, after!);
      expect(diff.truncated).toBe(true);
      expect(diff.diffText.length).toBeLessThanOrEqual(200_000);
    },
    15_000,
  );
});
