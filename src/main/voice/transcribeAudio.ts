import type { VoiceTranscriptionOutcome } from "../../shared/types";
import { loadSttConfigFromEnv } from "./config";
import { createSttProvider } from "./createProvider";
import type { SttProvider } from "./sttProvider";

// Testable core: given an already-constructed provider, transcribe and
// classify the result. Never throws — a provider/network error and an
// empty/silent result are reported as distinct reasons, mirroring
// interpretWithProvider in src/main/llm/interpretCanvasCommand.ts. Audio
// only ever flows in; nothing here writes it anywhere.
export async function transcribeWithProvider(provider: SttProvider, audio: Buffer, mimeType: string): Promise<VoiceTranscriptionOutcome> {
  let text: string;
  try {
    text = await provider.transcribe(audio, mimeType);
  } catch {
    return { ok: false, reason: "provider_error" };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, text: trimmed };
}

// Renderer-triggered only, once per finished recording (never per audio
// chunk, never streamed) — see src/main/ipc/voiceIpc.ts.
export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<VoiceTranscriptionOutcome> {
  const config = loadSttConfigFromEnv();
  if (!config) return { ok: false, reason: "not_configured" };
  return transcribeWithProvider(createSttProvider(config), audio, mimeType);
}
