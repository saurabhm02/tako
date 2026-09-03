import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readNewJsonlLines } from "./jsonlTail";
import type { UsageReport } from "../Adapter";

// Claude Code writes a real, structured transcript for every interactive
// session — including per-message token usage — to
// <config dir>/projects/<cwd with "/" replaced by "-">/<session-id>.jsonl,
// confirmed against a real transcript on disk. This is the tool's own
// authoritative session record, not something Tako parses out of its
// terminal UI — reading it doesn't change or reimplement the interactive
// experience at all (ADR-0002). Config dir defaults to $HOME/.claude but
// follows CLAUDE_CONFIG_DIR when a node uses a non-default profile
// (confirmed against a real CLAUDE_CONFIG_DIR-redirected transcript on
// disk — the whole tree moves, not just credentials).
function transcriptPath(configDir: string, cwd: string, sessionId: string): string {
  const encodedCwd = cwd.replace(/\//g, "-");
  return path.join(configDir, "projects", encodedCwd, `${sessionId}.jsonl`);
}

function projectDir(configDir: string, cwd: string): string {
  return path.join(configDir, "projects", cwd.replace(/\//g, "-"));
}

function listSessionFiles(configDir: string, cwd: string): string[] {
  try {
    return fs.readdirSync(projectDir(configDir, cwd)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return []; // no project dir yet — nothing has ever run here
  }
}

// A brand-new node (or one recovering from a failed --resume) starts
// Claude with no --session-id — Claude picks its own session id, and
// nothing tells Tako what it is. Discovering it: snapshot which transcript
// files already exist for this project right before starting (this
// function), then after starting, whichever *new* file appears
// (discoverNewSessionId below) is the one Claude just created. Real,
// on-disk evidence in the tool's own session directory — never a guess,
// never scraped from the terminal's own text (ADR-0002).
export function snapshotExistingSessionFiles(configDir: string, cwd: string): Set<string> {
  return new Set(listSessionFiles(configDir, cwd));
}

export function discoverNewSessionId(configDir: string, cwd: string, existingFiles: Set<string>): string | null {
  const newFile = listSessionFiles(configDir, cwd).find((f) => !existingFiles.has(f));
  return newFile ? newFile.replace(/\.jsonl$/, "") : null;
}

interface ClaudeTranscriptLine {
  type?: string;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

// No dollar figure here on purpose: Claude Code's transcript reports real
// token counts, but Tako has no verified, current Anthropic price table to
// convert them with (CT1 — never guess a cost). Tokens are still real
// numbers, not "unknown," they're just unpriced.
//
// Takes a resolver instead of a fixed id: a new (or resume-fallback-
// recovered) node has no known session id yet at reader-creation time —
// `getSessionId` is called fresh on every read so usage picks up real
// numbers as soon as the id is actually discovered, without needing a
// second, separate wiring path for "id not known yet."
export function createClaudeCodeUsageReader(
  cwd: string,
  getSessionId: () => string | null,
  configDir: string = path.join(os.homedir(), ".claude"),
): () => UsageReport | "unknown" {
  let linesRead = 0;

  return () => {
    const sessionId = getSessionId();
    if (!sessionId) return "unknown"; // session id not discovered yet

    const filePath = transcriptPath(configDir, cwd, sessionId);
    const { lines, totalLines } = readNewJsonlLines(filePath, linesRead);
    linesRead = totalLines;

    let tokens = 0;
    let sawUsage = false;
    for (const raw of lines) {
      let entry: ClaudeTranscriptLine;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      const usage = entry.type === "assistant" ? entry.message?.usage : undefined;
      if (!usage) continue;
      sawUsage = true;
      tokens +=
        (usage.input_tokens ?? 0) +
        (usage.output_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
    }

    return sawUsage ? { tokensOrUnits: tokens } : "unknown";
  };
}

interface ClaudeContentBlock {
  type?: string;
  text?: string;
}

interface ClaudeAssistantTranscriptLine {
  type?: string;
  message?: { content?: ClaudeContentBlock[] };
}

// Same transcript, same incremental-tail technique as the usage reader
// above — but instead of summing numbers, this whitelists only "text"
// content blocks from "assistant" entries as real, user-facing output.
// Claude Code's transcript mirrors Anthropic's own Messages API shape
// (confirmed against a real transcript on disk): an assistant turn is a
// content array mixing "thinking", "tool_use", and "text" blocks. Only
// "text" is ever treated as visible output — every other block type is
// excluded by not matching the one type this whitelists, never by trying
// to guess and exclude every other type by name (ADR-0002: real on-disk
// evidence, never scraped from the terminal's own rendering).
//
// Called once per completed turn (NodeManager.completeTurn), same call
// site/cadence as the usage reader, so "new lines since last call" always
// means "this turn's new assistant entries." If a turn produces more than
// one text-bearing assistant entry (e.g. a short comment, then more tool
// use, then the real answer), the LAST one wins — that's the actual final
// answer, not a running transcript of everything Claude ever said.
export function createClaudeCodeFinalOutputReader(
  cwd: string,
  getSessionId: () => string | null,
  configDir: string = path.join(os.homedir(), ".claude"),
): () => string | null {
  let linesRead = 0;

  return () => {
    const sessionId = getSessionId();
    if (!sessionId) return null;

    const filePath = transcriptPath(configDir, cwd, sessionId);
    const { lines, totalLines } = readNewJsonlLines(filePath, linesRead);
    linesRead = totalLines;

    let finalText: string | null = null;
    for (const raw of lines) {
      let entry: ClaudeAssistantTranscriptLine;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      if (entry.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
      const text = entry.message.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");
      if (text) finalText = text;
    }
    return finalText;
  };
}
