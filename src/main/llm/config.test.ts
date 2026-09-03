import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadLlmConfigFromEnv } from "./config";

const ENV_KEYS = ["TAKO_LLM_PROVIDER", "TAKO_LLM_API_KEY", "TAKO_LLM_MODEL", "TAKO_LLM_BASE_URL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("loadLlmConfigFromEnv", () => {
  test("no env vars set -> null (no LLM configured is a valid, silent state)", () => {
    expect(loadLlmConfigFromEnv()).toBeNull();
  });

  test("openai config maps cleanly", () => {
    process.env.TAKO_LLM_PROVIDER = "openai";
    process.env.TAKO_LLM_API_KEY = "sk-test";
    process.env.TAKO_LLM_MODEL = "gpt-test";
    expect(loadLlmConfigFromEnv()).toEqual({ provider: "openai", apiKey: "sk-test", model: "gpt-test" });
  });

  test("custom provider requires a base URL, missing one fails closed to null", () => {
    process.env.TAKO_LLM_PROVIDER = "custom";
    process.env.TAKO_LLM_API_KEY = "sk-test";
    process.env.TAKO_LLM_MODEL = "any/free";
    expect(loadLlmConfigFromEnv()).toBeNull();

    process.env.TAKO_LLM_BASE_URL = "https://openrouter.ai/api/v1";
    expect(loadLlmConfigFromEnv()).toEqual({
      provider: "custom",
      apiKey: "sk-test",
      model: "any/free",
      baseUrl: "https://openrouter.ai/api/v1",
    });
  });

  test("an unrecognized provider name fails closed to null, never guessed", () => {
    process.env.TAKO_LLM_PROVIDER = "totally-made-up";
    process.env.TAKO_LLM_API_KEY = "sk-test";
    process.env.TAKO_LLM_MODEL = "x";
    expect(loadLlmConfigFromEnv()).toBeNull();
  });

  test("a partially-set config (missing model) fails closed to null", () => {
    process.env.TAKO_LLM_PROVIDER = "anthropic";
    process.env.TAKO_LLM_API_KEY = "sk-test";
    expect(loadLlmConfigFromEnv()).toBeNull();
  });
});
