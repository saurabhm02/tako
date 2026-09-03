export interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

// CT1 (docs/06-decisions-log.md): never estimate or invent a cost. Kept
// deliberately small — a model missing from this table has no known price,
// so its usage is still recorded (tokensOrUnits) but its dollar cost stays
// unknown rather than guessed. Rates are published per-million-token API
// prices, not the flat subscription fee itself; they exist to give a real,
// token-based cost figure for usage that genuinely happened, not to
// represent a literal charge on the user's ChatGPT bill.
const MODEL_RATES: Record<string, ModelRate> = {
  "gpt-5": { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  "gpt-5.5": { inputPerMillion: 5.0, outputPerMillion: 30.0 },
  o3: { inputPerMillion: 2.0, outputPerMillion: 8.0 },
};

// Reasoning tokens are billed at the same rate as output tokens. Cached
// input tokens are priced the same as ordinary input tokens here — Codex's
// exact accounting between the two isn't reliably known, and treating them
// identically is a simpler, honest choice than guessing a discount.
export function calculateDollarCost(model: string, tokens: TokenBreakdown): number | undefined {
  const rate = MODEL_RATES[model];
  if (!rate) return undefined;
  return (
    (tokens.inputTokens / 1_000_000) * rate.inputPerMillion +
    ((tokens.outputTokens + tokens.reasoningOutputTokens) / 1_000_000) * rate.outputPerMillion
  );
}
