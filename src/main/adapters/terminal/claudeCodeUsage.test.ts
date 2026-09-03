import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClaudeCodeFinalOutputReader, createClaudeCodeUsageReader } from "./claudeCodeUsage";

const fakeCwd = "/tmp/tako-claude-usage-test-fixture";
const encodedCwd = fakeCwd.replace(/\//g, "-");
const projectDir = path.join(os.homedir(), ".claude", "projects", encodedCwd);

function transcriptFile(sessionId: string): string {
  return path.join(projectDir, `${sessionId}.jsonl`);
}

function assistantLine(usage: Record<string, number>): string {
  return JSON.stringify({ type: "assistant", message: { usage } });
}

function assistantContentLine(content: Array<{ type: string; text?: string }>): string {
  return JSON.stringify({ type: "assistant", message: { content } });
}

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("createClaudeCodeUsageReader", () => {
  test("no transcript file yet is unknown, not zero", () => {
    const reader = createClaudeCodeUsageReader(fakeCwd, () => "missing-session");
    expect(reader()).toBe("unknown");
  });

  test("sums real token fields from new assistant messages", () => {
    const sessionId = "session-a";
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      transcriptFile(sessionId),
      [
        assistantLine({ input_tokens: 2, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 3 }),
        JSON.stringify({ type: "user", message: {} }), // no usage — must be ignored, not crash
      ].join("\n") + "\n",
    );

    const reader = createClaudeCodeUsageReader(fakeCwd, () => sessionId);
    expect(reader()).toEqual({ tokensOrUnits: 20 });
  });

  test("a second call only counts new lines, not the whole transcript again", () => {
    const sessionId = "session-b";
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(transcriptFile(sessionId), assistantLine({ input_tokens: 10, output_tokens: 0 }) + "\n");

    const reader = createClaudeCodeUsageReader(fakeCwd, () => sessionId);
    expect(reader()).toEqual({ tokensOrUnits: 10 });

    fs.appendFileSync(transcriptFile(sessionId), assistantLine({ input_tokens: 1, output_tokens: 1 }) + "\n");
    expect(reader()).toEqual({ tokensOrUnits: 2 });
  });

  test("a turn with no assistant usage lines yet is unknown", () => {
    const sessionId = "session-c";
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(transcriptFile(sessionId), JSON.stringify({ type: "user", message: {} }) + "\n");

    const reader = createClaudeCodeUsageReader(fakeCwd, () => sessionId);
    expect(reader()).toBe("unknown");
  });

  // A node running under a non-default profile (CLAUDE_CONFIG_DIR) writes
  // its transcript under *that* config dir, not $HOME/.claude — confirmed
  // against a real CLAUDE_CONFIG_DIR-redirected transcript on disk. The
  // reader must follow the same dir, or usage silently stays "unknown"
  // forever for every profiled node.
  test("follows a non-default profile's config dir instead of the default one", () => {
    const sessionId = "session-profile";
    const profileConfigDir = path.join(os.homedir(), ".claude-tako-test-profile");
    const profileProjectDir = path.join(profileConfigDir, "projects", encodedCwd);
    fs.mkdirSync(profileProjectDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileProjectDir, `${sessionId}.jsonl`),
      assistantLine({ input_tokens: 7, output_tokens: 3 }) + "\n",
    );

    const reader = createClaudeCodeUsageReader(fakeCwd, () => sessionId, profileConfigDir);
    expect(reader()).toEqual({ tokensOrUnits: 10 });

    fs.rmSync(profileConfigDir, { recursive: true, force: true });
  });
});

describe("createClaudeCodeFinalOutputReader", () => {
  test("no transcript file yet is null, not empty text", () => {
    const reader = createClaudeCodeFinalOutputReader(fakeCwd, () => "missing-session");
    expect(reader()).toBeNull();
  });

  // The core regression: thinking and tool_use blocks must never leak into
  // the handoff payload, only the real "text" block.
  test("extracts only the text block, never thinking or tool_use blocks", () => {
    const sessionId = "session-final-a";
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      transcriptFile(sessionId),
      [
        assistantContentLine([
          { type: "thinking", text: "let me consider this carefully" },
          { type: "tool_use" },
          { type: "text", text: "The answer is 4." },
        ]),
      ].join("\n") + "\n",
    );

    const reader = createClaudeCodeFinalOutputReader(fakeCwd, () => sessionId);
    expect(reader()).toBe("The answer is 4.");
  });

  // A turn that never produces visible text (pure tool use, still in
  // progress) has nothing real to report yet — never falls back to
  // thinking/tool_use content just because it exists.
  test("a turn with only thinking/tool_use blocks (no text yet) is null", () => {
    const sessionId = "session-final-b";
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      transcriptFile(sessionId),
      assistantContentLine([{ type: "thinking", text: "still working" }, { type: "tool_use" }]) + "\n",
    );

    const reader = createClaudeCodeFinalOutputReader(fakeCwd, () => sessionId);
    expect(reader()).toBeNull();
  });

  // A multi-step turn (comment, then more tool use, then the real answer)
  // must report the LAST text block, not the first — that's the actual
  // final answer, not incidental narration along the way.
  test("the last text-bearing assistant entry wins across a multi-step turn", () => {
    const sessionId = "session-final-c";
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      transcriptFile(sessionId),
      [
        assistantContentLine([{ type: "text", text: "Let me check that file." }]),
        assistantContentLine([{ type: "tool_use" }]),
        assistantContentLine([{ type: "text", text: "Final answer: 42." }]),
      ].join("\n") + "\n",
    );

    const reader = createClaudeCodeFinalOutputReader(fakeCwd, () => sessionId);
    expect(reader()).toBe("Final answer: 42.");
  });

  test("a second call only reads new lines, same as the usage reader's cursor", () => {
    const sessionId = "session-final-d";
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(transcriptFile(sessionId), assistantContentLine([{ type: "text", text: "first" }]) + "\n");

    const reader = createClaudeCodeFinalOutputReader(fakeCwd, () => sessionId);
    expect(reader()).toBe("first");

    fs.appendFileSync(transcriptFile(sessionId), assistantContentLine([{ type: "text", text: "second" }]) + "\n");
    expect(reader()).toBe("second");
  });
});
