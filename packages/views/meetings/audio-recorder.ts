import { useCallback, useEffect, useRef, useState } from "react";

export type MeetingAudioRecorderState = "idle" | "recording" | "ready" | "error";

export type MeetingAudioRecording = {
  blob: Blob;
  url: string;
  mimeType: string;
  startedAt: Date;
  durationSeconds: number;
};

export type MeetingAudioRecorderController = {
  state: MeetingAudioRecorderState;
  error: string | null;
  elapsedSeconds: number;
  recording: MeetingAudioRecording | null;
  start: () => Promise<boolean>;
  stop: () => void;
  reset: () => void;
};

const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/aac",
] as const;

export function pickMeetingAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return (
    AUDIO_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ""
  );
}

export function getMeetingAudioExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("aac")) return "aac";
  return "webm";
}

export function buildMeetingAudioFileName(
  meetingTitle: string,
  startedAt: Date,
  mimeType: string,
): string {
  const safeTitle =
    meetingTitle
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "meeting-recording";
  const stamp = [
    startedAt.getFullYear(),
    padDatePart(startedAt.getMonth() + 1),
    padDatePart(startedAt.getDate()),
    "-",
    padDatePart(startedAt.getHours()),
    padDatePart(startedAt.getMinutes()),
    padDatePart(startedAt.getSeconds()),
  ].join("");
  return `${safeTitle}-${stamp}.${getMeetingAudioExtension(mimeType)}`;
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}

function getUnsupportedReason(): string | null {
  if (typeof MediaRecorder === "undefined") return "当前运行环境不支持录音保存";
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "当前运行环境不支持麦克风录音";
  }
  return null;
}

function getRecordingErrorMessage(caught: unknown): string {
  const name =
    caught && typeof caught === "object" && "name" in caught
      ? String((caught as { name?: unknown }).name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "麦克风权限未授权";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "未找到可用麦克风";
  if (caught instanceof Error && caught.message) return caught.message;
  return "录音启动失败";
}

export function useMeetingAudioRecorder(): MeetingAudioRecorderController {
  const [state, setState] = useState<MeetingAudioRecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recording, setRecording] = useState<MeetingAudioRecording | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<Date | null>(null);
  const startedAtMsRef = useRef(0);
  const recordingUrlRef = useRef<string | null>(null);

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

  const revokeRecordingUrl = useCallback(() => {
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Ignore stop races when the browser has already ended the recorder.
        }
      }
    }
    cleanupStream();
    revokeRecordingUrl();
    chunksRef.current = [];
    startedAtRef.current = null;
    startedAtMsRef.current = 0;
    setRecording(null);
    setElapsedSeconds(0);
    setError(null);
    setState("idle");
  }, [cleanupStream, revokeRecordingUrl]);

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            // Ignore stop races while unmounting.
          }
        }
      }
      cleanupStream();
      revokeRecordingUrl();
    },
    [cleanupStream, revokeRecordingUrl],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    cleanupStream();
  }, [cleanupStream]);

  const start = useCallback(async (): Promise<boolean> => {
    if (state === "recording") return true;

    const unsupportedReason = getUnsupportedReason();
    if (unsupportedReason) {
      setState("error");
      setError(unsupportedReason);
      return false;
    }

    revokeRecordingUrl();
    setRecording(null);
    setElapsedSeconds(0);
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const startedAt = new Date();
      const selectedMimeType = pickMeetingAudioMimeType();
      const recorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      startedAtRef.current = startedAt;
      startedAtMsRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const finalMimeType = selectedMimeType || recorder.mimeType || "audio/webm";
        const durationSeconds = Math.round((Date.now() - startedAtMsRef.current) / 1000);
        cleanupStream();
        if (chunksRef.current.length === 0) {
          setState("error");
          setError("没有录到音频");
          return;
        }
        const blob = new Blob(chunksRef.current, { type: finalMimeType });
        const url = URL.createObjectURL(blob);
        recordingUrlRef.current = url;
        setRecording({
          blob,
          url,
          mimeType: finalMimeType,
          startedAt: startedAtRef.current ?? startedAt,
          durationSeconds,
        });
        setElapsedSeconds(durationSeconds);
        setState("ready");
      };

      recorder.start();
      recorderRef.current = recorder;
      setState("recording");
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAtMsRef.current) / 1000));
      }, 250);
      return true;
    } catch (caught) {
      cleanupStream();
      setState("error");
      setError(getRecordingErrorMessage(caught));
      return false;
    }
  }, [cleanupStream, revokeRecordingUrl, state]);

  return {
    state,
    error,
    elapsedSeconds,
    recording,
    start,
    stop,
    reset,
  };
}
