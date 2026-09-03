import { describe, expect, test } from "bun:test";
import { diffLineKind, splitDiffByFile } from "./diffParsing";

describe("splitDiffByFile", () => {
  test("no diff text is no files", () => {
    expect(splitDiffByFile("")).toEqual([]);
  });

  test("a single-file diff is one segment", () => {
    const diff = "diff --git a/foo.ts b/foo.ts\nindex 111..222 100644\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new\n";
    expect(splitDiffByFile(diff)).toEqual([diff]);
  });

  test("a multi-file diff splits at each file header, in order", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+A\n",
      "diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-b\n+B\n",
    ].join("");
    const parts = splitDiffByFile(diff);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("a.ts");
    expect(parts[1]).toContain("b.ts");
  });
});

describe("diffLineKind", () => {
  test("a real added line is add, never confused with the +++ file header", () => {
    expect(diffLineKind("+++ b/foo.ts")).toBe("meta");
    expect(diffLineKind("+const x = 1;")).toBe("add");
  });

  test("a real removed line is remove, never confused with the --- file header", () => {
    expect(diffLineKind("--- a/foo.ts")).toBe("meta");
    expect(diffLineKind("-const x = 1;")).toBe("remove");
  });

  test("hunk headers and diff/index lines are meta", () => {
    expect(diffLineKind("@@ -1,3 +1,3 @@")).toBe("meta");
    expect(diffLineKind("diff --git a/foo.ts b/foo.ts")).toBe("meta");
    expect(diffLineKind("index 111..222 100644")).toBe("meta");
  });

  test("an unchanged context line is context", () => {
    expect(diffLineKind(" unchanged line")).toBe("context");
  });
});
