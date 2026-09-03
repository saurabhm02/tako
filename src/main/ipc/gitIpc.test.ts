import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getBranch } from "./gitIpc";

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitipc-test-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "file.txt"), "hi");
  execFileSync("git", ["add", "file.txt"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

describe("getBranch", () => {
  test("a real git repo returns its current branch", async () => {
    const dir = makeTempRepo();
    expect(await getBranch(dir)).toBe("main");
  });

  test("a directory that isn't a git repo resolves to null instead of throwing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitipc-noget-"));
    expect(await getBranch(dir)).toBeNull();
  });

  test("a directory that doesn't exist resolves to null instead of throwing", async () => {
    expect(await getBranch("/definitely/does/not/exist")).toBeNull();
  });
});
