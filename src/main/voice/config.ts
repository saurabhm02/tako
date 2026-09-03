// Dev/test-only config source (env vars), same pattern as
// src/main/llm/config.ts — isolated so a future Settings screen can
// produce the same SttConfig shape from stored keys instead of
// process.env; nothing downstream needs to change.
export type SttConfig = { provider: "deepgram"; apiKey: string; model: string | null };

// null means "no STT configured" — the mic button is disabled/hidden in
// that case, not an error state.
export function loadSttConfigFromEnv(): SttConfig | null {
  const provider = process.env.TAKO_STT_PROVIDER;
  const apiKey = process.env.TAKO_STT_API_KEY;
  if (!provider || !apiKey) return null;
  if (provider === "deepgram") {
    return { provider: "deepgram", apiKey, model: process.env.TAKO_STT_MODEL || null };
  }
  return null;
}
