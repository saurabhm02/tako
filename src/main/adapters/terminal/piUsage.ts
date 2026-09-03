import fs from "node:fs";
import path from "node:path";
import { readNewJsonlLines } from "./jsonlTail";
import type { UsageReport } from "../Adapter";

// Pi writes a real transcript per session under its session dir, named
// "<timestamp>_<session-id>.jsonl" — confirmed against a real file on
// disk. Unlike Claude Code, Pi's own transcript already includes a
// provider-priced dollar cost per message (usage.cost.total) — that's
// Pi's own number, not an Tako estimate, so it's used directly (CT1).
function findTranscriptPath(sessionDir: string, sessionId: string): string | null {
  if (!fs.existsSync(sessionDir)) return null;
  const match = fs.readdirSync(sessionDir).find((name) => name.endsWith(`${sessionId}.jsonl`));
  return match ? path.join(sessionDir, match) : null;
}

function listSessionFiles(sessionDir: string): string[] {
  if (!fs.existsSync(sessionDir)) return [];
  return fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
}

// A brand-new node starts Pi with no --session-id at all — Pi picks its
// own session id, written as "<timestamp>_<id>.jsonl" into this node's own
// session dir (already exclusive to one node via PI_CODING_AGENT_SESSION_DIR,
// ADR-0004, so no cwd/cross-node filtering is needed the way Claude Code's
// shared config dir needs).
// Discovering it: snapshot which files already exist right before
// starting, then whichever *new* file appears afterward is the one Pi just
// created. Real, on-disk evidence — never a guess (ADR-0002).
export function snapshotExistingSessionFiles(sessionDir: string): Set<string> {
  return new Set(listSessionFiles(sessionDir));
}

export function discoverNewSessionId(sessionDir: string, existingFiles: Set<string>): string | null {
  const newFile = listSessionFiles(sessionDir).find((f) => !existingFiles.has(f));
  if (!newFile) return null;
  // "<timestamp>_<uuid>.jsonl" — the id is everything after the first "_".
  const underscore = newFile.indexOf("_");
  const withoutExt = newFile.replace(/\.jsonl$/, "");
  return underscore === -1 ? withoutExt : withoutExt.slice(underscore + 1);
}

interface PiTranscriptLine {
  type?: string;
  message?: {
    role?: string;
    usage?: {
      totalTokens?: number;
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      cost?: { total?: number };
    };
  };
}

// Takes a resolver instead of a fixed id: a new node has no known session
// id yet at reader-creation time — `getSessionId` is called fresh on every
// read so usage picks up real numbers as soon as the id is discovered.
export function createPiUsageReader(sessionDir: string, getSessionId: () => string | null): () => UsageReport | "unknown" {
  let filePath: string | null = null;
  let linesRead = 0;

  return () => {
    if (!filePath) {
      const sessionId = getSessionId();
      if (!sessionId) return "unknown"; // session id not discovered yet
      filePath = findTranscriptPath(sessionDir, sessionId);
    }
    if (!filePath) return "unknown";

    const { lines, totalLines } = readNewJsonlLines(filePath, linesRead);
    linesRead = totalLines;

    let tokens = 0;
    let dollarCost = 0;
    let sawUsage = false;
    let sawCost = false;
    for (const raw of lines) {
      let entry: PiTranscriptLine;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      const usage = entry.type === "message" && entry.message?.role === "assistant" ? entry.message.usage : undefined;
      if (!usage) continue;
      sawUsage = true;
      tokens += usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      if (typeof usage.cost?.total === "number") {
        sawCost = true;
        dollarCost += usage.cost.total;
      }
    }

    if (!sawUsage) return "unknown";
    return { tokensOrUnits: tokens, dollarCost: sawCost ? dollarCost : undefined };
  };
}

interface PiContentBlock {
  type?: string;
  text?: string;
}

interface PiAssistantTranscriptLine {
  type?: string;
  message?: { role?: string; content?: PiContentBlock[] };
}

// Same idea as createClaudeCodeFinalOutputReader (claudeCodeUsage.ts):
// Pi's own transcript entries carry "api": "claude-bridge" and the exact
// same message.content block-array shape as Claude's own Messages API
// (confirmed against a real transcript on disk) — only "text" blocks are
// ever treated as final user-facing output, whitelisted by type rather
// than guessed at by excluding whatever else a block's type might be.
export function createPiFinalOutputReader(
  sessionDir: string,
  getSessionId: () => string | null,
): () => string | null {
  let filePath: string | null = null;
  let linesRead = 0;

  return () => {
    if (!filePath) {
      const sessionId = getSessionId();
      if (!sessionId) return null;
      filePath = findTranscriptPath(sessionDir, sessionId);
    }
    if (!filePath) return null;

    const { lines, totalLines } = readNewJsonlLines(filePath, linesRead);
    linesRead = totalLines;

    let finalText: string | null = null;
    for (const raw of lines) {
      let entry: PiAssistantTranscriptLine;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      if (entry.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
      const text = entry.message.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");
      if (text) finalText = text;
    }
    return finalText;
  };
}
