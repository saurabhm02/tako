import { MicrophonePermissionError, type AudioCaptureSession } from "./voiceRecorder";

// The only file in Voice v1 that touches a real microphone. Deliberately
// thin — every decision (state transitions, error classification, cleanup
// ordering) lives in the tested VoiceRecorder class; this just satisfies
// its StartCapture contract with real getUserMedia/MediaRecorder calls.
export async function startBrowserCapture(): Promise<AudioCaptureSession> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "PermissionDeniedError")) {
      throw new MicrophonePermissionError("Microphone access was denied.");
    }
    throw e;
  }

  const preferredMimeType = "audio/webm";
  const mimeType = typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(preferredMimeType) ? preferredMimeType : "";
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });
  recorder.start();

  // Never leaves a track running after stop/cancel — repeated start/stop
  // must never accumulate open microphone streams.
  const releaseStream = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    stop(): Promise<{ audio: ArrayBuffer; mimeType: string }> {
      return new Promise((resolve, reject) => {
        recorder.addEventListener(
          "stop",
          () => {
            const finalMimeType = recorder.mimeType || mimeType || "audio/webm";
            new Blob(chunks, { type: finalMimeType })
              .arrayBuffer()
              .then((audio) => resolve({ audio, mimeType: finalMimeType }))
              .catch(reject)
              .finally(releaseStream);
          },
          { once: true },
        );
        recorder.stop();
      });
    },
    cancel(): void {
      if (recorder.state !== "inactive") recorder.stop();
      releaseStream();
    },
  };
}
