import { describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import { commandExists } from "./commandExists";

describe("commandExists", () => {
  test("finds a binary that's genuinely on PATH", () => {
    // `node` is guaranteed present — this whole test suite runs under it.
    expect(commandExists(process.platform === "win32" ? "node.exe" : "node")).toBe(true);
  });

  test("a binary that doesn't exist anywhere on PATH is false", () => {
    expect(commandExists("tako-definitely-not-a-real-binary-xyz")).toBe(false);
  });

  test("caches the result instead of rescanning PATH on every call", () => {
    const spy = spyOn(fs, "statSync");
    commandExists("node"); // first call for this command — may hit the filesystem
    const callsDuringFirst = spy.mock.calls.length;
    commandExists("node"); // second call — must be served from the cache
    const callsDuringSecond = spy.mock.calls.length - callsDuringFirst;
    expect(callsDuringSecond).toBe(0);
    spy.mockRestore();
  });
});
