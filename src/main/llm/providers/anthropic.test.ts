import { describe, expect, test } from "bun:test";
import { runAnthropicMessage } from "./anthropic";

describe("runAnthropicMessage — request/response mapping, no real SDK/network call", () => {
  test("sends the prompt as a single user message and extracts the text block", async () => {
    let seenRequest: unknown;
    const fakeClient = {
      messages: {
        create: async (req: unknown) => {
          seenRequest = req;
          return { content: [{ type: "text", text: '{"actions":[{"type":"clearAll"}]}' }] };
        },
      },
    } as Parameters<typeof runAnthropicMessage>[0];

    const result = await runAnthropicMessage(fakeClient, "claude-test", "clear the board");

    expect(result).toBe('{"actions":[{"type":"clearAll"}]}');
    expect(seenRequest).toMatchObject({ model: "claude-test", messages: [{ role: "user", content: "clear the board" }] });
  });

  test("a response with no text block maps to an empty string, not a throw", async () => {
    const fakeClient = { messages: { create: async () => ({ content: [{ type: "tool_use" }] }) } } as unknown as Parameters<typeof runAnthropicMessage>[0];
    expect(await runAnthropicMessage(fakeClient, "claude-test", "hi")).toBe("");
  });
});
