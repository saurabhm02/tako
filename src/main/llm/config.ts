// Dev/test-only config source (env vars). Isolated on purpose — a future
// Settings screen just needs to produce the same LlmConfig shape from
// stored keys instead of process.env; nothing downstream (providers,
// interpretCanvasCommand) needs to change.
export type LlmConfig =
  | { provider: "openai"; apiKey: string; model: string }
  | { provider: "anthropic"; apiKey: string; model: string }
  | { provider: "gemini"; apiKey: string; model: string }
  | { provider: "custom"; apiKey: string; model: string; baseUrl: string };

// null means "no LLM configured" — the command bar's deterministic parser
// already covers the whole v1 command set on its own, so this is a real,
// expected, silent-fallback state, not an error.
export function loadLlmConfigFromEnv(): LlmConfig | null {
  const provider = process.env.TAKO_LLM_PROVIDER;
  const apiKey = process.env.TAKO_LLM_API_KEY;
  const model = process.env.TAKO_LLM_MODEL;
  if (!provider || !apiKey || !model) return null;

  if (provider === "openai" || provider === "anthropic" || provider === "gemini") {
    return { provider, apiKey, model };
  }
  if (provider === "custom") {
    const baseUrl = process.env.TAKO_LLM_BASE_URL;
    if (!baseUrl) return null;
    return { provider: "custom", apiKey, model, baseUrl };
  }
  return null;
}
