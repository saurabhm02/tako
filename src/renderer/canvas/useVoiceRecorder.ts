import { useEffect, useRef, useState } from "react";
import { VoiceRecorder, type VoiceState } from "./voiceRecorder";
import { startBrowserCapture } from "./voiceCapture";

// Thin React binding over VoiceRecorder — one instance per mount, disposed
// on unmount, state changes re-rendered via subscribe(). All the actual
// decision-making (and everything this file does NOT need its own test
// for) lives in the tested VoiceRecorder class.
export function useVoiceRecorder(onTranscript: (text: string) => void) {
  const recorderRef = useRef<VoiceRecorder | null>(null);
  if (!recorderRef.current) {
    recorderRef.current = new VoiceRecorder(startBrowserCapture, (audio, mimeType) => window.tako.voice.transcribe(audio, mimeType), onTranscript);
  }

  const [state, setState] = useState<VoiceState>(() => recorderRef.current!.getState());

  useEffect(() => recorderRef.current!.subscribe(setState), []);
  useEffect(() => () => recorderRef.current!.dispose(), []);

  const recorder = recorderRef.current;
  return { state, start: () => recorder.start(), stop: () => recorder.stop(), cancel: () => recorder.cancel() };
}
