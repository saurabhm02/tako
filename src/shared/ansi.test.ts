import { describe, expect, test } from "bun:test";
import { stripAnsi } from "./ansi";

describe("stripAnsi", () => {
  test("removes color and cursor-movement escape codes", () => {
    const raw = "\x1b[31mred text\x1b[0m and \x1b[2K\x1b[1Gcleared line";
    expect(stripAnsi(raw)).toBe("red text and cleared line");
  });

  test("leaves plain text untouched", () => {
    expect(stripAnsi("just plain text, no codes")).toBe("just plain text, no codes");
  });

  test("removes OSC sequences (e.g. terminal title changes)", () => {
    const raw = "\x1b]0;window title\x07visible text";
    expect(stripAnsi(raw)).toBe("visible text");
  });

  test("removes modern TUI sequences (kitty keyboard protocol, save/restore cursor)", () => {
    const raw = "\x1b7\x1b8\x1b[<u\x1b[>1u\x1b[>4;2mvisible text";
    expect(stripAnsi(raw)).toBe("visible text");
  });
});
