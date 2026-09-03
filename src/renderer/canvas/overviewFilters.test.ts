import { describe, expect, test } from "bun:test";
import { formatRelativeTime, matchesOverviewFilter, matchesSearch, statusBucket, type OverviewRow } from "./overviewFilters";

function row(overrides: Partial<OverviewRow> = {}): OverviewRow {
  return {
    id: "a",
    name: "Orion",
    agentType: "claude-code",
    profileId: "",
    status: "idle",
    bucket: "completed",
    pendingHandoffCount: 0,
    cost: null,
    lastActivityAt: null,
    ...overrides,
  };
}

describe("statusBucket", () => {
  test("working and starting are running", () => {
    expect(statusBucket("working")).toBe("running");
    expect(statusBucket("starting")).toBe("running");
  });

  test("handoff_ready is waiting — never inferred from a connection", () => {
    expect(statusBucket("handoff_ready")).toBe("waiting");
  });

  test("error is error", () => {
    expect(statusBucket("error")).toBe("error");
  });

  test("idle and not_started are completed", () => {
    expect(statusBucket("idle")).toBe("completed");
    expect(statusBucket("not_started")).toBe("completed");
  });
});

describe("matchesOverviewFilter", () => {
  test("all matches every bucket", () => {
    expect(matchesOverviewFilter(row({ bucket: "error" }), "all")).toBe(true);
  });

  test("a specific filter only matches its own bucket", () => {
    expect(matchesOverviewFilter(row({ bucket: "running" }), "running")).toBe(true);
    expect(matchesOverviewFilter(row({ bucket: "waiting" }), "running")).toBe(false);
  });
});

describe("matchesSearch", () => {
  test("an empty query matches everything", () => {
    expect(matchesSearch(row({ name: "Orion" }), "")).toBe(true);
    expect(matchesSearch(row({ name: "Orion" }), "   ")).toBe(true);
  });

  test("search is case-insensitive and matches a substring", () => {
    expect(matchesSearch(row({ name: "Orion" }), "ori")).toBe(true);
    expect(matchesSearch(row({ name: "Orion" }), "ORION")).toBe(true);
  });

  test("a non-matching query excludes the row", () => {
    expect(matchesSearch(row({ name: "Orion" }), "draco")).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  const now = 1_000_000;

  test("no activity yet is a dash, never a fake time", () => {
    expect(formatRelativeTime(null, now)).toBe("—");
  });

  test("just happened reads as 'just now'", () => {
    expect(formatRelativeTime(now - 2_000, now)).toBe("just now");
  });

  test("seconds/minutes/hours scale correctly", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("30s ago");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  });
});
