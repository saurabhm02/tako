import type { VoiceTranscriptionOutcome } from "../../shared/types";

export type VoiceState =
  | { status: "idle" }
  | { status: "listening" }
  | { status: "transcribing" }
  | { status: "error"; message: string };

// Thrown by a StartCapture implementation to distinguish "the user said no"
// from any other capture failure (no device, browser refused, etc.) — the
// vocabulary lives here (the tested orchestrator), not in the real
// browser-API file, so this class never needs to import anything DOM-only.
export class MicrophonePermissionError extends Error {}

export interface AudioCaptureSession {
  // Stops recording and resolves with everything actually said, plus the
  // real mime type MediaRecorder used. Releases the microphone.
  stop(): Promise<{ audio: ArrayBuffer; mimeType: string }>;
  // Stops recording and releases the microphone WITHOUT producing audio —
  // used for Escape/cancel, never reaches transcription.
  cancel(): void;
}
export type StartCapture = () => Promise<AudioCaptureSession>;
export type Transcribe = (audio: ArrayBuffer, mimeType: string) => Promise<VoiceTranscriptionOutcome>;

const PERMISSION_DENIED_MESSAGE = "Microphone access was denied. Allow microphone access to use voice.";
const CAPTURE_FAILED_MESSAGE = "Could not access the microphone.";
// Exported so CommandBar can show the identical message from its own
// pre-flight availability check (voice.isAvailable) — one string, not two
// copies that could quietly drift apart.
export const VOICE_NOT_CONFIGURED_MESSAGE = "Voice isn't set up yet.";
type TranscriptionFailureReason = Extract<VoiceTranscriptionOutcome, { ok: false }>["reason"];
const TRANSCRIPTION_ERROR_MESSAGES: Record<TranscriptionFailureReason, string> = {
  not_configured: VOICE_NOT_CONFIGURED_MESSAGE,
  provider_error: "Couldn't reach the transcription service.",
  empty: "Didn't catch anything — try again.",
};

// The whole orchestration: what start/stop/cancel do, in what state, and
// what a permission denial or a failed transcription looks like. Framework-
// free and fully testable with fake StartCapture/Transcribe implementations
// — no real microphone, no real network call, no React. The renderer's
// useVoiceRecorder hook (voiceCapture.ts) is a thin binding on top of this;
// the real browser APIs live only there, deliberately outside this file.
export class VoiceRecorder {
  private state: VoiceState = { status: "idle" };
  private session: AudioCaptureSession | null = null;
  private listeners = new Set<(state: VoiceState) => void>();

  constructor(
    private readonly startCapture: StartCapture,
    private readonly transcribe: Transcribe,
    private readonly onTranscript: (text: string) => void,
  ) {}

  getState(): VoiceState {
    return this.state;
  }

  subscribe(fn: (state: VoiceState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(next: VoiceState): void {
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }

  // A no-op while already listening/transcribing — clicking the mic twice
  // fast, or a stray repeat call, never opens a second microphone stream.
  async start(): Promise<void> {
    if (this.state.status === "listening" || this.state.status === "transcribing") return;
    try {
      this.session = await this.startCapture();
      this.setState({ status: "listening" });
    } catch (e) {
      this.session = null;
      this.setState({ status: "error", message: e instanceof MicrophonePermissionError ? PERMISSION_DENIED_MESSAGE : CAPTURE_FAILED_MESSAGE });
    }
  }

  // Stops the microphone stream immediately and discards whatever was
  // recorded — never reaches transcription, never sends anything over IPC.
  cancel(): void {
    if (this.state.status !== "listening") return; // nothing open to cancel
    this.session?.cancel();
    this.session = null;
    this.setState({ status: "idle" });
  }

  async stop(): Promise<void> {
    if (this.state.status !== "listening") return;
    const session = this.session;
    this.session = null;
    if (!session) {
      this.setState({ status: "idle" });
      return;
    }
    this.setState({ status: "transcribing" });
    try {
      const { audio, mimeType } = await session.stop();
      const outcome = await this.transcribe(audio, mimeType);
      if (outcome.ok) {
        this.onTranscript(outcome.text);
        this.setState({ status: "idle" });
      } else {
        this.setState({ status: "error", message: TRANSCRIPTION_ERROR_MESSAGES[outcome.reason] });
      }
    } catch {
      this.setState({ status: "error", message: "Something went wrong transcribing that." });
    }
  }

  // Called on unmount, and safe to call more than once — a still-open
  // microphone stream is always released, listeners are always cleared, no
  // matter how many start/stop/cancel cycles happened before it.
  dispose(): void {
    this.session?.cancel();
    this.session = null;
    this.listeners.clear();
  }
}
