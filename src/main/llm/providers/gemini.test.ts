import { describe, expect, test } from "bun:test";
import { runGeminiGenerate } from "./gemini";

describe("runGeminiGenerate — request/response mapping, no real SDK/network call", () => {
  test("requests the configured model and JSON mime type, extracts response text", async () => {
    let seenModelOpts: unknown;
    const fakeClient = {
      getGenerativeModel: (opts: unknown) => {
        seenModelOpts = opts;
        return { generateContent: async () => ({ response: { text: () => '{"actions":[{"type":"stopAll"}]}' } }) };
      },
    } as Parameters<typeof runGeminiGenerate>[0];

    const result = await runGeminiGenerate(fakeClient, "gemini-test", "stop everything");

    expect(result).toBe('{"actions":[{"type":"stopAll"}]}');
    expect(seenModelOpts).toMatchObject({ model: "gemini-test", generationConfig: { responseMimeType: "application/json" } });
  });
});
