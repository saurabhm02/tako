import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider } from "../provider";

type MessagesClient = Pick<Anthropic, "messages">;

export async function runAnthropicMessage(client: MessagesClient, model: string, prompt: string): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const block = response.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

export function createAnthropicProvider(apiKey: string, model: string): LlmProvider {
  const client = new Anthropic({ apiKey });
  return { interpret: (prompt) => runAnthropicMessage(client, model, prompt) };
}
