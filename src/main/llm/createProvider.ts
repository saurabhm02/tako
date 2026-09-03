import type { LlmConfig } from "./config";
import type { LlmProvider } from "./provider";
import { createOpenAiProvider } from "./providers/openai";
import { createAnthropicProvider } from "./providers/anthropic";
import { createGeminiProvider } from "./providers/gemini";
import { createCustomProvider } from "./providers/custom";

export function createProvider(config: LlmConfig): LlmProvider {
  switch (config.provider) {
    case "openai":
      return createOpenAiProvider(config.apiKey, config.model);
    case "anthropic":
      return createAnthropicProvider(config.apiKey, config.model);
    case "gemini":
      return createGeminiProvider(config.apiKey, config.model);
    case "custom":
      return createCustomProvider(config.apiKey, config.model, config.baseUrl);
  }
}
