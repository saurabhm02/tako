import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPiFinalOutputReader, createPiUsageReader } from "./piUsage";

let sessionDir: string;

function assistantLine(usage: Record<string, unknown>): string {
  return JSON.stringify({ type: "message", message: { role: "assistant", usage } });
}

function assistantContentLine(content: Array<{ type: string; text?: string }>): string {
  return JSON.stringify({ type: "message", message: { role: "assistant", content } });
}

afterEach(() => {
  if (sessionDir) fs.rmSync(sessionDir, { recursive: true, force: true });
});

describe("createPiUsageReader", () => {
  test("no session directory yet is unknown, not zero", () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-pi-usage-"));
    fs.rmSync(sessionDir, { recursive: true, force: true }); // never created
    const reader = createPiUsageReader(sessionDir, () => "missing-session");
    expect(reader()).toBe("unknown");
  });

  test("finds the timestamp-prefixed transcript and reports Pi's own real cost", () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-pi-usage-"));
    const sessionId = "session-a";
    fs.writeFileSync(
      path.join(sessionDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`),
      [
        JSON.stringify({ type: "session" }),
        assistantLine({ totalTokens: 120, cost: { total: 0.004 } }),
        JSON.stringify({ type: "message", message: { role: "user" } }), // no usage — ignored
      ].join("\n") + "\n",
    );

    const reader = createPiUsageReader(sessionDir, () => sessionId);
    expect(reader()).toEqual({ tokensOrUnits: 120, dollarCost: 0.004 });
  });

  test("real tokens with no cost field stays priceless, not a guessed $0", () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-pi-usage-"));
    const sessionId = "session-b";
    fs.writeFileSync(
      path.join(sessionDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`),
      assistantLine({ input: 5, output: 5 }) + "\n",
    );

    const reader = createPiUsageReader(sessionDir, () => sessionId);
    expect(reader()).toEqual({ tokensOrUnits: 10, dollarCost: undefined });
  });

  test("a second call only counts new lines, and sums real reported cost", () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-pi-usage-"));
    const sessionId = "session-c";
    const file = path.join(sessionDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`);
    fs.writeFileSync(file, assistantLine({ totalTokens: 50, cost: { total: 0.01 } }) + "\n");

    const reader = createPiUsageReader(sessionDir, () => sessionId);
    expect(reader()).toEqual({ tokensOrUnits: 50, dollarCost: 0.01 });

    fs.appendFileSync(file, assistantLine({ totalTokens: 5, cost: { total: 0.001 } }) + "\n");
    expect(reader()).toEqual({ tokensOrUnits: 5, dollarCost: 0.001 });
  });
});

describe("createPiFinalOutputReader", () => {
  test("no session directory yet is null, not empty text", () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-pi-final-"));
    fs.rmSync(sessionDir, { recursive: true, force: true }); // never created
    const reader = createPiFinalOutputReader(sessionDir, () => "missing-session");
    expect(reader()).toBeNull();
  });

  // The core regression: Pi's own "claude-bridge" transcript mixes text
  // with other block types the same way Claude Code's does — only "text"
  // may ever reach the handoff payload.
  test("extracts only the text block, never other content block types", () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-pi-final-"));
    const sessionId = "session-final-a";
    fs.writeFileSync(
      path.join(sessionDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`),
      [
        JSON.stringify({ type: "session" }),
        assistantContentLine([{ type: "tool_use" }, { type: "text", text: "envvartest42" }]),
      ].join("\n") + "\n",
    );

    const reader = createPiFinalOutputReader(sessionDir, () => sessionId);
    expect(reader()).toBe("envvartest42");
  });

  test("the last text-bearing assistant entry wins across a multi-step turn", () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-pi-final-"));
    const sessionId = "session-final-b";
    fs.writeFileSync(
      path.join(sessionDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`),
      [
        assistantContentLine([{ type: "text", text: "checking now" }]),
        assistantContentLine([{ type: "tool_use" }]),
        assistantContentLine([{ type: "text", text: "Final answer: 42." }]),
      ].join("\n") + "\n",
    );

    const reader = createPiFinalOutputReader(sessionDir, () => sessionId);
    expect(reader()).toBe("Final answer: 42.");
  });
});
