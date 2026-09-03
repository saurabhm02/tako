import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandExists } from "../adapters/commandExists";

// ponytail: same cap NodeManager already uses for outputBuffer — big
// enough for a real turn's diff, small enough to stop one huge turn from
// growing SQLite without bound.
const MAX_DIFF_CHARS = 200_000;

function run(cwd: string, args: string[], env?: Record<string, string>): Promise<{ stdout: string; ok: boolean }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, env: env ? { ...process.env, ...env } : process.env, timeout: 15_000, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout) => resolve({ stdout: stdout ?? "", ok: !err }),
    );
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  if (!commandExists("git")) return false;
  const { stdout, ok } = await run(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return ok && stdout.trim() === "true";
}

// A non-destructive snapshot of the FULL working tree (tracked + untracked,
// .gitignore respected) as a real git tree object. GIT_INDEX_FILE points
// git at a scratch file instead of the repo's real index, so `add -A` and
// `write-tree` never touch the user's real staged changes or working
// tree — no commit, no stash entry, nothing to clean up in the repo itself.
export async function snapshotTree(cwd: string): Promise<string | null> {
  if (!(await isGitRepo(cwd))) return null;
  const indexFile = path.join(os.tmpdir(), `tako-git-index-${crypto.randomUUID()}`);
  try {
    const env = { GIT_INDEX_FILE: indexFile };
    const add = await run(cwd, ["add", "-A"], env);
    if (!add.ok) return null;
    const write = await run(cwd, ["write-tree"], env);
    return write.ok ? write.stdout.trim() || null : null;
  } finally {
    fs.rm(indexFile, { force: true }, () => {});
  }
}

export interface FileChange {
  path: string;
  oldPath: string | null;
  insertions: number;
  deletions: number;
  binary: boolean;
  status: "added" | "modified" | "deleted" | "renamed";
}

export interface TreeDiff {
  files: FileChange[];
  insertions: number;
  deletions: number;
  diffText: string;
  truncated: boolean;
}

const STATUS_MAP: Record<string, FileChange["status"]> = { A: "added", M: "modified", D: "deleted" };

// name-status, numstat, and the actual patch are three separate `git diff`
// calls against the exact same two trees — git's tree-walk order is
// deterministic, so all three iterate files identically and can be paired
// by index. Simpler and more robust than parsing numstat's ambiguous
// "old => new" rename text back into a path.
export async function diffTrees(cwd: string, beforeTree: string, afterTree: string): Promise<TreeDiff> {
  if (beforeTree === afterTree) {
    return { files: [], insertions: 0, deletions: 0, diffText: "", truncated: false };
  }

  const [nameStatus, numstat, patch] = await Promise.all([
    run(cwd, ["diff", "--name-status", "-M", beforeTree, afterTree]),
    run(cwd, ["diff", "--numstat", "-M", beforeTree, afterTree]),
    run(cwd, ["diff", "-M", beforeTree, afterTree]),
  ]);

  const nameStatusLines = nameStatus.stdout.split("\n").filter(Boolean);
  const numstatLines = numstat.stdout.split("\n").filter(Boolean);

  let insertions = 0;
  let deletions = 0;
  const files: FileChange[] = nameStatusLines.map((line, i) => {
    const [code, a, b] = line.split("\t");
    const isRename = code.startsWith("R");
    const filePath = isRename ? b : a;
    const oldPath = isRename ? a : null;
    const status: FileChange["status"] = isRename ? "renamed" : (STATUS_MAP[code] ?? "modified");

    const [insRaw, delRaw] = (numstatLines[i] ?? "").split("\t");
    const binary = insRaw === "-" && delRaw === "-";
    const fileIns = binary ? 0 : Number(insRaw) || 0;
    const fileDel = binary ? 0 : Number(delRaw) || 0;
    insertions += fileIns;
    deletions += fileDel;

    return { path: filePath, oldPath, insertions: fileIns, deletions: fileDel, binary, status };
  });

  const truncated = patch.stdout.length > MAX_DIFF_CHARS;
  const diffText = truncated ? patch.stdout.slice(0, MAX_DIFF_CHARS) : patch.stdout;

  return { files, insertions, deletions, diffText, truncated };
}
