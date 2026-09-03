import { DeepgramClient } from "@deepgram/sdk";
import type { SttProvider } from "../sttProvider";

// Only the one method actually used, and only the response fields read —
// lets tests inject a fake without constructing a real client or making a
// network call. Mirrors src/main/llm/providers/openai.ts's ChatClient shape.
export interface MediaClient {
  transcribeFile(
    uploadable: { data: Buffer; contentType: string },
    request: { model: string; smart_format: boolean; punctuate: boolean },
  ): Promise<{ results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } }>;
}
export interface ListenClient {
  v1: { media: MediaClient };
}

const DEFAULT_MODEL = "nova-3";

export async function runDeepgramTranscription(client: ListenClient, audio: Buffer, mimeType: string, model: string): Promise<string> {
  const response = await client.v1.media.transcribeFile({ data: audio, contentType: mimeType }, { model, smart_format: true, punctuate: true });
  return response.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
}

export function createDeepgramProvider(apiKey: string, model: string | null): SttProvider {
  const client = new DeepgramClient({ apiKey });
  // The real SDK's response type is a union that also covers async-callback
  // mode, which this never uses (no `callback` option is ever set) — the
  // narrow ListenClient interface above is what's actually read at runtime.
  const listen = client.listen as unknown as ListenClient;
  return { transcribe: (audio, mimeType) => runDeepgramTranscription(listen, audio, mimeType, model ?? DEFAULT_MODEL) };
}
