import { describe, expect, test } from "bun:test";
import { runOpenAiChat } from "./openai";

describe("runOpenAiChat — request/response mapping, no real SDK/network call", () => {
  test("sends the prompt as a single user message and extracts the text", async () => {
    let seenRequest: unknown;
    const fakeClient = {
      chat: {
        completions: {
          create: async (req: unknown) => {
            seenRequest = req;
            return { choices: [{ message: { content: '{"actions":[{"type":"stopAll"}]}' } }] };
          },
        },
      },
    } as Parameters<typeof runOpenAiChat>[0];

    const result = await runOpenAiChat(fakeClient, "gpt-test", "stop everything");

    expect(result).toBe('{"actions":[{"type":"stopAll"}]}');
    expect(seenRequest).toMatchObject({
      model: "gpt-test",
      messages: [{ role: "user", content: "stop everything" }],
      response_format: { type: "json_object" },
    });
  });

  test("an empty/missing choice maps to an empty string, not a throw", async () => {
    const fakeClient = { chat: { completions: { create: async () => ({ choices: [] }) } } } as unknown as Parameters<typeof runOpenAiChat>[0];
    expect(await runOpenAiChat(fakeClient, "gpt-test", "hi")).toBe("");
  });
});
