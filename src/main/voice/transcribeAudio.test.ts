import { describe, expect, test } from "bun:test";
import { transcribeWithProvider } from "./transcribeAudio";
import type { SttProvider } from "./sttProvider";

function fakeProvider(reply: string): SttProvider {
  return { transcribe: async () => reply };
}

describe("transcribeWithProvider — fail-closed wrapper around a provider call", () => {
  test("a real transcript passes through, trimmed", async () => {
    const result = await transcribeWithProvider(fakeProvider("  stop apollo  "), Buffer.from("audio"), "audio/webm");
    expect(result).toEqual({ ok: true, text: "stop apollo" });
  });

  test("an empty transcript (silence, unintelligible audio) is its own distinct reason, not treated as a provider error", async () => {
    const result = await transcribeWithProvider(fakeProvider(""), Buffer.from("audio"), "audio/webm");
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  test("whitespace-only transcript is treated the same as empty", async () => {
    const result = await transcribeWithProvider(fakeProvider("   "), Buffer.from("audio"), "audio/webm");
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  test("a provider that throws (network error, auth failure, etc.) fails closed with reason provider_error, never throws to the caller", async () => {
    const throwingProvider: SttProvider = {
      transcribe: async () => {
        throw new Error("401 Unauthorized");
      },
    };
    const result = await transcribeWithProvider(throwingProvider, Buffer.from("audio"), "audio/webm");
    expect(result).toEqual({ ok: false, reason: "provider_error" });
  });
});
