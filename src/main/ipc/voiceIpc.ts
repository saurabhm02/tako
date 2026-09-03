import { ipcMain } from "electron";
import { transcribeAudio } from "../voice/transcribeAudio";
import { loadSttConfigFromEnv } from "../voice/config";

export function registerVoiceIpc(): void {
  // Audio crosses the IPC boundary once, as a single already-recorded
  // buffer (structured-clone-transferable ArrayBuffer) — never a stream,
  // never per-chunk, never persisted to disk on either side.
  ipcMain.handle("voice:transcribe", (_e, audio: ArrayBuffer, mimeType: string) => transcribeAudio(Buffer.from(audio), mimeType));

  // A plain config read — no audio, no network, no mic permission needed
  // to answer this. Lets the command bar tell the user "voice isn't set
  // up" on click, before ever opening the microphone, instead of only
  // finding out after a full record-and-fail round trip.
  ipcMain.handle("voice:isAvailable", () => loadSttConfigFromEnv() !== null);
}
