import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LlmProvider } from "../provider";

// Just the one method used — same injectable shape as the other providers.
interface GenerativeClient {
  getGenerativeModel(opts: { model: string; generationConfig?: { responseMimeType?: string } }): {
    generateContent(prompt: string): Promise<{ response: { text(): string } }>;
  };
}

export async function runGeminiGenerate(client: GenerativeClient, model: string, prompt: string): Promise<string> {
  const generativeModel = client.getGenerativeModel({ model, generationConfig: { responseMimeType: "application/json" } });
  const result = await generativeModel.generateContent(prompt);
  return result.response.text();
}

export function createGeminiProvider(apiKey: string, model: string): LlmProvider {
  const client = new GoogleGenerativeAI(apiKey);
  return { interpret: (prompt) => runGeminiGenerate(client, model, prompt) };
}
