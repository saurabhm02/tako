import { describe, expect, test } from "bun:test";
import { calculateDollarCost } from "./pricing";

describe("calculateDollarCost", () => {
  test("a known model prices input and output tokens at their own rates", () => {
    const cost = calculateDollarCost("gpt-5", { inputTokens: 10, outputTokens: 32, reasoningOutputTokens: 0 });
    expect(cost).toBeCloseTo(0.0003325, 10);
  });

  test("reasoning tokens are billed at the output rate", () => {
    const withReasoning = calculateDollarCost("gpt-5", { inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 100 });
    const asOutput = calculateDollarCost("gpt-5", { inputTokens: 0, outputTokens: 100, reasoningOutputTokens: 0 });
    expect(withReasoning).toBe(asOutput);
  });

  test("a model missing from the table returns undefined, never a guessed number", () => {
    expect(calculateDollarCost("some-future-model", { inputTokens: 1000, outputTokens: 1000, reasoningOutputTokens: 0 })).toBeUndefined();
  });

  test("zero usage costs zero for a known model", () => {
    expect(calculateDollarCost("gpt-5", { inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 })).toBe(0);
  });
});
