import fs from "node:fs";

// Reads whatever lines have been appended to a growing JSONL file since the
// last read — used to pull only *this turn's* new entries out of a real
// agent's own on-disk session transcript, never the whole file's history
// again. Missing file (session hasn't written yet) is a normal, expected
// case, not an error.
export function readNewJsonlLines(filePath: string, linesAlreadyRead: number): { lines: string[]; totalLines: number } {
  if (!fs.existsSync(filePath)) return { lines: [], totalLines: linesAlreadyRead };
  const content = fs.readFileSync(filePath, "utf8");
  const allLines = content.split("\n").filter((line) => line.trim().length > 0);
  return { lines: allLines.slice(linesAlreadyRead), totalLines: allLines.length };
}
