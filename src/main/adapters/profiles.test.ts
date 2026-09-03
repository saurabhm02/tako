import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listProfiles, profileConfigDir, profileEnv, supportsProfiles } from "./profiles";

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tako-profiles-test-"));

afterEach(() => {
  for (const entry of fs.readdirSync(homeDir)) {
    fs.rmSync(path.join(homeDir, entry), { recursive: true, force: true });
  }
});

describe("supportsProfiles", () => {
  test("only Claude Code and Pi have a profile concept", () => {
    expect(supportsProfiles("claude-code")).toBe(true);
    expect(supportsProfiles("pi")).toBe(true);
    expect(supportsProfiles("codex")).toBe(false);
    expect(supportsProfiles("codex-chatgpt")).toBe(false);
    expect(supportsProfiles("bash")).toBe(false);
  });
});

describe("listProfiles", () => {
  test("an agent with no profile concept returns nothing", () => {
    expect(listProfiles("codex", homeDir)).toEqual([]);
  });

  test("always includes Default even with no sibling directories on disk", () => {
    expect(listProfiles("claude-code", homeDir)).toEqual([{ id: "", label: "Default" }]);
  });

  // Mirrors the real machine this was verified against: $HOME/.claude
  // (default) plus $HOME/.claude-saurabh (a second local account).
  test("discovers a real sibling profile directory and title-cases its name", () => {
    fs.mkdirSync(path.join(homeDir, ".claude-saurabh"));

    expect(listProfiles("claude-code", homeDir)).toEqual([
      { id: "", label: "Default" },
      { id: "saurabh", label: "Saurabh" },
    ]);
  });

  test("ignores files that merely start with the same prefix (e.g. .claude.json)", () => {
    fs.writeFileSync(path.join(homeDir, ".claude.json"), "{}");

    expect(listProfiles("claude-code", homeDir)).toEqual([{ id: "", label: "Default" }]);
  });

  test("Pi profiles are discovered the same way, under .pi/agent-<name>", () => {
    fs.mkdirSync(path.join(homeDir, ".pi", "agent-work"), { recursive: true });

    expect(listProfiles("pi", homeDir)).toEqual([
      { id: "", label: "Default" },
      { id: "work", label: "Work" },
    ]);
  });
});

describe("profileConfigDir / profileEnv", () => {
  test("the default profile resolves to the agent's own default dir with no env override", () => {
    expect(profileConfigDir("claude-code", "", homeDir)).toBe(path.join(homeDir, ".claude"));
    expect(profileEnv("claude-code", "", homeDir)).toEqual({});
  });

  test("a named profile resolves to the sibling dir and sets the real env var", () => {
    expect(profileConfigDir("claude-code", "saurabh", homeDir)).toBe(path.join(homeDir, ".claude-saurabh"));
    expect(profileEnv("claude-code", "saurabh", homeDir)).toEqual({
      CLAUDE_CONFIG_DIR: path.join(homeDir, ".claude-saurabh"),
    });
  });

  test("Pi uses PI_CODING_AGENT_DIR, not CLAUDE_CONFIG_DIR", () => {
    expect(profileEnv("pi", "work", homeDir)).toEqual({
      PI_CODING_AGENT_DIR: path.join(homeDir, ".pi", "agent-work"),
    });
  });
});
