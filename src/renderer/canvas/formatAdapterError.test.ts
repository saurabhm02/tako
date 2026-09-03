import { describe, expect, test } from "bun:test";
import { formatAdapterError } from "./types";

// The one shared formatter both ChatConversation's error bubble and
// AgentNode's terminal-node error banner read from — proves every error
// kind gets a real human-readable label, never the raw enum value.
describe("formatAdapterError", () => {
  test("auth errors read as a sign-in problem, not the raw kind", () => {
    expect(formatAdapterError({ kind: "auth", message: "Not logged in", recoverable: true })).toBe(
      "Sign-in needed — Not logged in",
    );
  });

  test("crash errors are labeled distinctly from a generic unknown error", () => {
    expect(formatAdapterError({ kind: "crash", message: "process died", recoverable: false })).toBe(
      "Agent crashed — process died",
    );
    expect(formatAdapterError({ kind: "unknown", message: "boom", recoverable: true })).toBe(
      "Something went wrong — boom",
    );
  });
});
