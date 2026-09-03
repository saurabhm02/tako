import { describe, expect, test } from "bun:test";
import { formatDuration } from "./RunHistoryViewer";

describe("formatDuration", () => {
  test("still running (no endedAt) has no duration to show", () => {
    expect(formatDuration(1000, null)).toBeNull();
  });

  test("scales seconds/minutes/hours", () => {
    expect(formatDuration(0, 45_000)).toBe("45s");
    expect(formatDuration(0, 5 * 60_000)).toBe("5m");
    expect(formatDuration(0, 90 * 60_000)).toBe("1h 30m");
  });
});
