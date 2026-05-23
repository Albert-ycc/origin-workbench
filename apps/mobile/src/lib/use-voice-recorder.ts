import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "preview" | "uploading" | "error";

const MAX_RECORDING_SECONDS = 30;

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/aac",
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

export interface VoiceRecorderController {
  state: RecorderState;
  elapsed: number;
  error: string | null;
  blob: Blob | null;
  previewUrl: string | null;
  mimeType: string;
  maxSeconds: number;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  setUploading: () => void;
  setError: (message: string) => void;
}

export function useVoiceRecorder(): VoiceRecorderController {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setErrorState] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const previewUrlRef = useRef<string | null>(null);

  const cleanupStream = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupStream();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [cleanupStream]);

  const start = useCallback(async () => {
    if (state === "recording") return;
    setErrorState(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorState("此浏览器不支持录音");
      setState("error");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setErrorState("此浏览器不支持 MediaRecorder");
      setState("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const selectedMime = pickMimeType();
      setMimeType(selectedMime);

      const recorder = selectedMime
        ? new MediaRecorder(stream, { mimeType: selectedMime })
        : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const finalType = selectedMime || recorder.mimeType || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, { type: finalType });
        const url = URL.createObjectURL(audioBlob);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setBlob(audioBlob);
        setPreviewUrl(url);
        setState("preview");
        cleanupStream();
      };

      recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState("recording");

      timerRef.current = window.setInterval(() => {
        const next = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(next);
        if (next >= MAX_RECORDING_SECONDS && recorder.state === "recording") {
          recorder.stop();
        }
      }, 250);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "无法访问麦克风，检查浏览器权限";
      setErrorState(message);
      setState("error");
      cleanupStream();
    }
  }, [state, cleanupStream]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  }, []);

  const reset = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setBlob(null);
    setPreviewUrl(null);
    setElapsed(0);
    setErrorState(null);
    setState("idle");
  }, []);

  const setUploading = useCallback(() => setState("uploading"), []);

  const setError = useCallback((message: string) => {
    setErrorState(message);
    setState("error");
  }, []);

  return {
    state,
    elapsed,
    error,
    blob,
    previewUrl,
    mimeType,
    maxSeconds: MAX_RECORDING_SECONDS,
    start,
    stop,
    reset,
    setUploading,
    setError,
  };
}
