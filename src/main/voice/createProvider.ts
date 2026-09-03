import type { SttConfig } from "./config";
import type { SttProvider } from "./sttProvider";
import { createDeepgramProvider } from "./providers/deepgram";

// One branch today; the seam (config -> provider) is what a second STT
// provider (local Whisper, another vendor) plugs into later — same shape
// as src/main/llm/createProvider.ts.
export function createSttProvider(config: SttConfig): SttProvider {
  switch (config.provider) {
    case "deepgram":
      return createDeepgramProvider(config.apiKey, config.model);
  }
}
