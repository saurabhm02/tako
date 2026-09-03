// One method: send recorded audio, get text back. Provider-specific detail
// (auth, request shape, response extraction) stays inside its own file —
// nothing else in the app needs to know which STT provider is active. Same
// shape as LlmProvider (src/main/llm/provider.ts) on purpose.
export interface SttProvider {
  transcribe(audio: Buffer, mimeType: string): Promise<string>;
}
