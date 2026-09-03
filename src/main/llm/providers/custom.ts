import { createOpenAiProvider } from "./openai";
import type { LlmProvider } from "../provider";

// "Custom" is just the OpenAI client pointed at a different baseURL —
// OpenRouter, Ollama, and any other OpenAI-compatible endpoint all speak
// the same request/response shape, so there's nothing provider-specific
// left to write. No separate OpenRouter module.
export function createCustomProvider(apiKey: string, model: string, baseUrl: string): LlmProvider {
  return createOpenAiProvider(apiKey, model, baseUrl);
}
