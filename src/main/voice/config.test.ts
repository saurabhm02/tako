import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadSttConfigFromEnv } from "./config";

const ENV_KEYS = ["TAKO_STT_PROVIDER", "TAKO_STT_API_KEY", "TAKO_STT_MODEL"] as const;
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

describe("loadSttConfigFromEnv", () => {
  test("no env vars set -> null (no STT configured is a valid, silent state)", () => {
    expect(loadSttConfigFromEnv()).toBeNull();
  });

  test("deepgram config maps cleanly, model optional", () => {
    process.env.TAKO_STT_PROVIDER = "deepgram";
    process.env.TAKO_STT_API_KEY = "dg-test";
    expect(loadSttConfigFromEnv()).toEqual({ provider: "deepgram", apiKey: "dg-test", model: null });

    process.env.TAKO_STT_MODEL = "nova-3";
    expect(loadSttConfigFromEnv()).toEqual({ provider: "deepgram", apiKey: "dg-test", model: "nova-3" });
  });

  test("an unrecognized provider name fails closed to null, never guessed", () => {
    process.env.TAKO_STT_PROVIDER = "totally-made-up";
    process.env.TAKO_STT_API_KEY = "dg-test";
    expect(loadSttConfigFromEnv()).toBeNull();
  });

  test("a missing api key fails closed to null", () => {
    process.env.TAKO_STT_PROVIDER = "deepgram";
    expect(loadSttConfigFromEnv()).toBeNull();
  });
});
