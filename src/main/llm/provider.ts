// One method: send the prompt, get text back. Every provider-specific
// detail (auth, request shape, response extraction) stays inside its own
// file — nothing else in the app needs to know which provider is active.
export interface LlmProvider {
  interpret(prompt: string): Promise<string>;
}
