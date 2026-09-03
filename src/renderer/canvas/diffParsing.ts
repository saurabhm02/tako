// Pure, presentation-only parsing for the Code Changes viewer — no
// re-diffing, just splitting the already-persisted unified diff text.

// git emits one file's patch per "diff --git a/... b/..." header, in the
// same deterministic order as the file list (all three git invocations
// that produced files/diffText ran against the identical pair of trees).
// Splitting by index instead of matching paths sidesteps quoting/rename
// edge cases entirely.
export function splitDiffByFile(diffText: string): string[] {
  if (!diffText.trim()) return [];
  return diffText.split(/(?=^diff --git )/m).filter((part) => part.trim().length > 0);
}

export type DiffLineKind = "add" | "remove" | "meta" | "context";

// "+++"/"---" are file headers, not real +/- content lines — only a bare
// leading +/- on an actual content line counts.
export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("@@")) return "meta";
  return "context";
}
