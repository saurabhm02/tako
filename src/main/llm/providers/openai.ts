import OpenAI from "openai";
import type { LlmProvider } from "../provider";

// Only the one method actually used — lets tests inject a fake without
// constructing a real OpenAI client or making a network call.
type ChatClient = Pick<OpenAI, "chat">;

export async function runOpenAiChat(client: ChatClient, model: string, prompt: string): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });
  return response.choices[0]?.message?.content ?? "";
}

export function createOpenAiProvider(apiKey: string, model: string, baseURL?: string): LlmProvider {
  const client = new OpenAI({ apiKey, baseURL });
  return { interpret: (prompt) => runOpenAiChat(client, model, prompt) };
}
