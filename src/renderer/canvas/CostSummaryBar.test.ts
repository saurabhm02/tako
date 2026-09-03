import { describe, expect, test } from "bun:test";
import { formatCostLine } from "./CostSummaryBar";

describe("formatCostLine", () => {
  test("nothing has run yet", () => {
    expect(formatCostLine(null)).toBe("No usage yet");
  });

  test("real dollar cost and real tokens", () => {
    expect(formatCostLine({ dollarTotal: 0.184, tokensOrUnits: 8400, hasUnknown: false })).toBe("$0.18 · 8.4K tokens");
  });

  test("real tokens with no known price never shows a fake $0.00", () => {
    expect(formatCostLine({ dollarTotal: 0, tokensOrUnits: 900, hasUnknown: true })).toBe("900 tokens");
  });

  test("nothing known at all is unavailable, not zero", () => {
    expect(formatCostLine({ dollarTotal: 0, tokensOrUnits: 0, hasUnknown: true })).toBe("Usage unavailable");
  });

  test("small token counts aren't abbreviated", () => {
    expect(formatCostLine({ dollarTotal: 0, tokensOrUnits: 42, hasUnknown: true })).toBe("42 tokens");
  });
});
