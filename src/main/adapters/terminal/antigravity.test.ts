import { describe, expect, test } from "bun:test";
import { createAntigravityAdapter } from "./antigravity";

function input(overrides: Partial<Parameters<typeof createAntigravityAdapter>[0]> = {}) {
  return {
    nodeId: "node-1",
    workingDirectory: "/tmp",
    config: {},
    resumeSessionRef: null,
    ...overrides,
  };
}

describe("createAntigravityAdapter", () => {
  test("requires a working directory", () => {
    expect(() => createAntigravityAdapter(input({ workingDirectory: null }))).toThrow("Antigravity requires a working directory");
  });

  test("creates a TerminalAdapter instance targeting agy with working directory", () => {
    const adapter = createAntigravityAdapter(input({ workingDirectory: "/tmp/project" }));
    expect(adapter).toBeDefined();
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.stop).toBe("function");
  });
});
