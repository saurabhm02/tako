import { describe, expect, test } from "bun:test";
import { MicrophonePermissionError, VoiceRecorder, type AudioCaptureSession, type StartCapture, type Transcribe, type VoiceState } from "./voiceRecorder";
import type { VoiceTranscriptionOutcome } from "../../shared/types";

function makeFakeSession() {
  const calls = { stop: 0, cancel: 0 };
  const session: AudioCaptureSession = {
    stop: async () => {
      calls.stop++;
      return { audio: new ArrayBuffer(4), mimeType: "audio/webm" };
    },
    cancel: () => {
      calls.cancel++;
    },
  };
  return { session, calls };
}

function makeStartCapture(sessions: AudioCaptureSession[]): { startCapture: StartCapture; callCount: () => number } {
  let calls = 0;
  return {
    startCapture: async () => {
      calls++;
      const s = sessions[calls - 1];
      if (!s) throw new Error("startCapture called more times than sessions provided");
      return s;
    },
    callCount: () => calls,
  };
}

function deniedCapture(): StartCapture {
  return async () => {
    throw new MicrophonePermissionError("denied");
  };
}

function failingCapture(message = "no device"): StartCapture {
  return async () => {
    throw new Error(message);
  };
}

function makeTranscribe(outcome: VoiceTranscriptionOutcome | (() => Promise<VoiceTranscriptionOutcome>)): { transcribe: Transcribe; callCount: () => number } {
  let calls = 0;
  return {
    transcribe: async () => {
      calls++;
      return typeof outcome === "function" ? outcome() : outcome;
    },
    callCount: () => calls,
  };
}

function makeRecorder(startCapture: StartCapture, transcribe: Transcribe) {
  const transcripts: string[] = [];
  const recorder = new VoiceRecorder(startCapture, transcribe, (text) => transcripts.push(text));
  return { recorder, transcripts };
}

describe("VoiceRecorder — state transitions", () => {
  test("starts idle", () => {
    const { session } = makeFakeSession();
    const { recorder } = makeRecorder(makeStartCapture([session]).startCapture, makeTranscribe({ ok: true, text: "x" }).transcribe);
    expect(recorder.getState()).toEqual({ status: "idle" });
  });

  test("start() opens a session and transitions to listening", async () => {
    const { session } = makeFakeSession();
    const { recorder } = makeRecorder(makeStartCapture([session]).startCapture, makeTranscribe({ ok: true, text: "x" }).transcribe);
    await recorder.start();
    expect(recorder.getState()).toEqual({ status: "listening" });
  });

  test("stop() while listening moves through transcribing to idle on success, delivering the transcript", async () => {
    const { session } = makeFakeSession();
    const { transcribe } = makeTranscribe({ ok: true, text: "stop apollo" });
    const { recorder, transcripts } = makeRecorder(makeStartCapture([session]).startCapture, transcribe);
    const seen: VoiceState[] = [];
    recorder.subscribe((s) => seen.push(s));

    await recorder.start();
    await recorder.stop();

    expect(seen.map((s) => s.status)).toEqual(["listening", "transcribing", "idle"]);
    expect(transcripts).toEqual(["stop apollo"]);
  });
});

describe("VoiceRecorder — start/stop/cancel", () => {
  test("start() while already listening never opens a second session", async () => {
    const { session } = makeFakeSession();
    const { startCapture, callCount } = makeStartCapture([session]);
    const { recorder } = makeRecorder(startCapture, makeTranscribe({ ok: true, text: "x" }).transcribe);
    await recorder.start();
    await recorder.start();
    expect(callCount()).toBe(1);
    expect(recorder.getState()).toEqual({ status: "listening" });
  });

  test("cancel() while listening stops the session without ever calling transcribe", async () => {
    const { session, calls } = makeFakeSession();
    const { transcribe, callCount } = makeTranscribe({ ok: true, text: "x" });
    const { recorder, transcripts } = makeRecorder(makeStartCapture([session]).startCapture, transcribe);
    await recorder.start();
    recorder.cancel();
    expect(calls.cancel).toBe(1);
    expect(calls.stop).toBe(0);
    expect(callCount()).toBe(0);
    expect(transcripts).toEqual([]);
    expect(recorder.getState()).toEqual({ status: "idle" });
  });

  test("cancel() while idle is a safe no-op", () => {
    const { recorder } = makeRecorder(makeStartCapture([]).startCapture, makeTranscribe({ ok: true, text: "x" }).transcribe);
    expect(() => recorder.cancel()).not.toThrow();
    expect(recorder.getState()).toEqual({ status: "idle" });
  });

  test("stop() while idle (nothing recording) is a safe no-op", async () => {
    const { transcribe, callCount } = makeTranscribe({ ok: true, text: "x" });
    const { recorder } = makeRecorder(makeStartCapture([]).startCapture, transcribe);
    await recorder.stop();
    expect(callCount()).toBe(0);
    expect(recorder.getState()).toEqual({ status: "idle" });
  });
});

describe("VoiceRecorder — permission and capture failure", () => {
  test("a denied microphone permission produces a clear, specific error", async () => {
    const { recorder } = makeRecorder(deniedCapture(), makeTranscribe({ ok: true, text: "x" }).transcribe);
    await recorder.start();
    const state = recorder.getState();
    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).toMatch(/denied/i);
  });

  test("a non-permission capture failure (no device, etc.) produces a different, still-clear message", async () => {
    const { recorder } = makeRecorder(failingCapture(), makeTranscribe({ ok: true, text: "x" }).transcribe);
    await recorder.start();
    const state = recorder.getState();
    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).not.toMatch(/denied/i);
  });

  test("after an error, start() can be retried", async () => {
    const { session } = makeFakeSession();
    let attempt = 0;
    const startCapture: StartCapture = async () => {
      attempt++;
      if (attempt === 1) throw new Error("transient failure");
      return session;
    };
    const { recorder } = makeRecorder(startCapture, makeTranscribe({ ok: true, text: "x" }).transcribe);
    await recorder.start();
    expect(recorder.getState().status).toBe("error");
    await recorder.start();
    expect(recorder.getState()).toEqual({ status: "listening" });
  });
});

describe("VoiceRecorder — transcription outcomes", () => {
  test("a real transcript is delivered via onTranscript exactly once", async () => {
    const { session } = makeFakeSession();
    const { recorder, transcripts } = makeRecorder(makeStartCapture([session]).startCapture, makeTranscribe({ ok: true, text: "connect apollo to reviewer" }).transcribe);
    await recorder.start();
    await recorder.stop();
    expect(transcripts).toEqual(["connect apollo to reviewer"]);
  });

  test("empty transcription (silence) shows a distinct error, never delivers a blank transcript", async () => {
    const { session } = makeFakeSession();
    const { recorder, transcripts } = makeRecorder(makeStartCapture([session]).startCapture, makeTranscribe({ ok: false, reason: "empty" }).transcribe);
    await recorder.start();
    await recorder.stop();
    expect(transcripts).toEqual([]);
    const state = recorder.getState();
    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).not.toBe("");
  });

  test("provider/network failure during transcription fails closed to an error state, never delivers a transcript", async () => {
    const { session } = makeFakeSession();
    const { recorder, transcripts } = makeRecorder(makeStartCapture([session]).startCapture, makeTranscribe({ ok: false, reason: "provider_error" }).transcribe);
    await recorder.start();
    await recorder.stop();
    expect(transcripts).toEqual([]);
    expect(recorder.getState().status).toBe("error");
  });

  test("voice not configured on the main process fails closed with its own message", async () => {
    const { session } = makeFakeSession();
    const { recorder, transcripts } = makeRecorder(makeStartCapture([session]).startCapture, makeTranscribe({ ok: false, reason: "not_configured" }).transcribe);
    await recorder.start();
    await recorder.stop();
    expect(transcripts).toEqual([]);
    expect(recorder.getState().status).toBe("error");
  });

  test("the three failure reasons produce three distinct messages, not one generic string", async () => {
    const messages = new Set<string>();
    for (const reason of ["not_configured", "provider_error", "empty"] as const) {
      const { session } = makeFakeSession();
      const { recorder } = makeRecorder(makeStartCapture([session]).startCapture, makeTranscribe({ ok: false, reason }).transcribe);
      await recorder.start();
      await recorder.stop();
      const state = recorder.getState();
      if (state.status === "error") messages.add(state.message);
    }
    expect(messages.size).toBe(3);
  });

  test("a transcribe call that throws outright (not just an {ok:false} result) still fails closed, never throws to the caller", async () => {
    const { session } = makeFakeSession();
    const throwingTranscribe: Transcribe = async () => {
      throw new Error("network down");
    };
    const { recorder, transcripts } = makeRecorder(makeStartCapture([session]).startCapture, throwingTranscribe);
    await recorder.start();
    await expect(recorder.stop()).resolves.toBeUndefined();
    expect(transcripts).toEqual([]);
    expect(recorder.getState().status).toBe("error");
  });

  test("session.stop() itself throwing (recorder failure) also fails closed", async () => {
    const throwingSession: AudioCaptureSession = {
      stop: async () => {
        throw new Error("recorder died");
      },
      cancel: () => {},
    };
    const { recorder, transcripts } = makeRecorder(makeStartCapture([throwingSession]).startCapture, makeTranscribe({ ok: true, text: "x" }).transcribe);
    await recorder.start();
    await recorder.stop();
    expect(transcripts).toEqual([]);
    expect(recorder.getState().status).toBe("error");
  });
});

describe("VoiceRecorder — repeated start/stop and cleanup", () => {
  test("repeated start/stop cycles never leak a session and each cycle uses its own fresh session", async () => {
    const first = makeFakeSession();
    const second = makeFakeSession();
    const { startCapture, callCount } = makeStartCapture([first.session, second.session]);
    const { recorder, transcripts } = makeRecorder(startCapture, makeTranscribe({ ok: true, text: "hi" }).transcribe);

    await recorder.start();
    await recorder.stop();
    await recorder.start();
    await recorder.stop();

    expect(callCount()).toBe(2);
    expect(first.calls.stop).toBe(1);
    expect(second.calls.stop).toBe(1);
    expect(transcripts).toEqual(["hi", "hi"]);
    expect(recorder.getState()).toEqual({ status: "idle" });
  });

  test("subscribing does not duplicate notifications across repeated start/stop cycles", async () => {
    const first = makeFakeSession();
    const second = makeFakeSession();
    const { startCapture } = makeStartCapture([first.session, second.session]);
    const { recorder } = makeRecorder(startCapture, makeTranscribe({ ok: true, text: "hi" }).transcribe);
    const seen: VoiceState["status"][] = [];
    recorder.subscribe((s) => seen.push(s.status));

    await recorder.start();
    await recorder.stop();
    await recorder.start();
    await recorder.stop();

    expect(seen).toEqual(["listening", "transcribing", "idle", "listening", "transcribing", "idle"]);
  });

  test("unsubscribe stops further notifications", async () => {
    const { session } = makeFakeSession();
    const { recorder } = makeRecorder(makeStartCapture([session]).startCapture, makeTranscribe({ ok: true, text: "hi" }).transcribe);
    const seen: VoiceState["status"][] = [];
    const unsubscribe = recorder.subscribe((s) => seen.push(s.status));
    await recorder.start();
    unsubscribe();
    await recorder.stop();
    expect(seen).toEqual(["listening"]);
  });

  test("dispose() while listening cancels the open session", async () => {
    const { session, calls } = makeFakeSession();
    const { recorder } = makeRecorder(makeStartCapture([session]).startCapture, makeTranscribe({ ok: true, text: "hi" }).transcribe);
    await recorder.start();
    recorder.dispose();
    expect(calls.cancel).toBe(1);
  });

  test("dispose() clears subscribers — no further notifications after disposal", async () => {
    const { session } = makeFakeSession();
    const { recorder } = makeRecorder(makeStartCapture([session]).startCapture, makeTranscribe({ ok: true, text: "hi" }).transcribe);
    const seen: VoiceState["status"][] = [];
    recorder.subscribe((s) => seen.push(s.status));
    await recorder.start();
    recorder.dispose();
    seen.length = 0;
    recorder.cancel(); // dispose already cleared the session; this must not notify a cleared listener
    expect(seen).toEqual([]);
  });

  test("dispose() when idle is a safe no-op", () => {
    const { recorder } = makeRecorder(makeStartCapture([]).startCapture, makeTranscribe({ ok: true, text: "x" }).transcribe);
    expect(() => recorder.dispose()).not.toThrow();
  });
});
