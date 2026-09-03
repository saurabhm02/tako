import { describe, expect, test } from "bun:test";
import { runDeepgramTranscription, type ListenClient } from "./deepgram";

function fakeClient(response: unknown): ListenClient {
  return { v1: { media: { transcribeFile: async () => response as Awaited<ReturnType<ListenClient["v1"]["media"]["transcribeFile"]>> } } };
}

describe("runDeepgramTranscription — request/response mapping, no real SDK/network call", () => {
  test("extracts the first channel's first alternative's transcript", async () => {
    const client = fakeClient({ results: { channels: [{ alternatives: [{ transcript: "stop apollo" }] }] } });
    const result = await runDeepgramTranscription(client, Buffer.from("fake audio"), "audio/webm", "nova-3");
    expect(result).toBe("stop apollo");
  });

  test("sends the audio buffer, mime type, and model in the request", async () => {
    let seenUploadable: unknown;
    let seenRequest: unknown;
    const client: ListenClient = {
      v1: {
        media: {
          transcribeFile: async (uploadable, request) => {
            seenUploadable = uploadable;
            seenRequest = request;
            return { results: { channels: [{ alternatives: [{ transcript: "" }] }] } };
          },
        },
      },
    };
    const audio = Buffer.from("fake audio");
    await runDeepgramTranscription(client, audio, "audio/webm", "nova-3");
    expect(seenUploadable).toEqual({ data: audio, contentType: "audio/webm" });
    expect(seenRequest).toMatchObject({ model: "nova-3" });
  });

  test("no channels/alternatives at all (silence) maps to an empty string, not a throw", async () => {
    const client = fakeClient({ results: { channels: [] } });
    expect(await runDeepgramTranscription(client, Buffer.from("x"), "audio/webm", "nova-3")).toBe("");
  });

  test("a missing results field entirely maps to an empty string, not a throw", async () => {
    const client = fakeClient({});
    expect(await runDeepgramTranscription(client, Buffer.from("x"), "audio/webm", "nova-3")).toBe("");
  });
});
