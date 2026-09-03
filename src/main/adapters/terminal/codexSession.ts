import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readNewJsonlLines } from "./jsonlTail";

// Codex writes one real transcript file per session under
// <codex home>/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-id>.jsonl
// — confirmed against real files on disk (`codex exec` prints the exact
// same session id it then writes there). Unlike Claude Code's per-project
// directory, Codex's session store is flat across every project — a
// session's own first line (a real "session_meta" event Codex itself
// writes, recording both its session_id and the cwd it ran in) is what
// safely scopes discovery to *this* node's own working directory instead
// of picking up an unrelated session. Never a guess, never scraped from
// the terminal (ADR-0002).

export function defaultCodexHome(): string {
  return path.join(os.homedir(), ".codex");
}

function sessionsRoot(codexHome: string): string {
  return path.join(codexHome, "sessions");
}

function listSessionFiles(codexHome: string): string[] {
  try {
    return fs
      .readdirSync(sessionsRoot(codexHome), { recursive: true })
      .filter((f): f is string => typeof f === "string" && f.endsWith(".jsonl"));
  } catch {
    return []; // no sessions dir yet — nothing has ever run here
  }
}

interface SessionMetaLine {
  type?: string;
  payload?: { session_id?: string; cwd?: string };
}

function readSessionMeta(filePath: string): SessionMetaLine | null {
  try {
    const firstLine = fs.readFileSync(filePath, "utf8").split("\n", 1)[0];
    return firstLine ? JSON.parse(firstLine) : null;
  } catch {
    return null; // unreadable/partially-written file — not this node's session
  }
}

export function snapshotExistingSessionFiles(codexHome: string): Set<string> {
  return new Set(listSessionFiles(codexHome));
}

export function discoverNewSessionId(codexHome: string, cwd: string, existingFiles: Set<string>): string | null {
  const newFiles = listSessionFiles(codexHome).filter((f) => !existingFiles.has(f));
  for (const file of newFiles) {
    const meta = readSessionMeta(path.join(sessionsRoot(codexHome), file));
    if (meta?.type === "session_meta" && meta.payload?.cwd === cwd && meta.payload.session_id) {
      return meta.payload.session_id;
    }
  }
  return null;
}

function findSessionFilePath(codexHome: string, sessionId: string): string | null {
  const match = listSessionFiles(codexHome).find((f) => f.endsWith(`-${sessionId}.jsonl`));
  return match ? path.join(sessionsRoot(codexHome), match) : null;
}

interface CodexRolloutLine {
  type?: string;
  payload?: { type?: string; last_agent_message?: string };
}

// Codex's own rollout log marks a turn's real final reply with a
// dedicated event ("task_complete".last_agent_message) — confirmed
// against a real rollout file on disk. This is more direct than Claude
// Code/Pi's content-block filtering: no block-type whitelist needed, just
// the one field Codex itself uses to record "this is what I told the
// user," distinct from reasoning/tool-call/web-search events in the same
// log (ADR-0002: real on-disk evidence, never scraped from the terminal).
export function createCodexFinalOutputReader(
  codexHome: string,
  getSessionId: () => string | null,
): () => string | null {
  let filePath: string | null = null;
  let linesRead = 0;

  return () => {
    if (!filePath) {
      const sessionId = getSessionId();
      if (!sessionId) return null;
      filePath = findSessionFilePath(codexHome, sessionId);
    }
    if (!filePath) return null;

    const { lines, totalLines } = readNewJsonlLines(filePath, linesRead);
    linesRead = totalLines;

    let finalMessage: string | null = null;
    for (const raw of lines) {
      let entry: CodexRolloutLine;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      if (entry.type === "event_msg" && entry.payload?.type === "task_complete" && typeof entry.payload.last_agent_message === "string") {
        finalMessage = entry.payload.last_agent_message;
      }
    }
    return finalMessage;
  };
}
