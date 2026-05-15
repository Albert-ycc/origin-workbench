import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionAlternativeLike = {
  transcript?: string;
};

type SpeechRecognitionResultLike = {
  isFinal?: boolean;
  0?: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorLike = {
  error?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type DesktopMicrophoneAPI = {
  getMicrophonePermissionStatus?: () => Promise<
    "not-determined" | "granted" | "denied" | "restricted" | "unknown"
  >;
  requestMicrophonePermission?: () => Promise<boolean>;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export type LiveTranscriptionStatus =
  | "idle"
  | "requesting"
  | "listening"
  | "unsupported"
  | "error";

export function collectFinalTranscript(event: SpeechRecognitionEventLike): string {
  const parts: string[] = [];
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result?.isFinal) continue;
    const text = result[0]?.transcript?.trim();
    if (text) parts.push(text);
  }
  return parts.join(" ").trim();
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

async function requestMicrophoneAccess(): Promise<boolean> {
  const desktopAPI =
    typeof window === "undefined"
      ? undefined
      : (window as unknown as { desktopAPI?: DesktopMicrophoneAPI }).desktopAPI;
  const status = await desktopAPI?.getMicrophonePermissionStatus?.();
  if (status === "denied" || status === "restricted") return false;
  if (status === "not-determined") {
    const granted = await desktopAPI?.requestMicrophonePermission?.();
    if (granted === false) return false;
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return true;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
  return true;
}

export function useLiveTranscription({
  lang = "zh-CN",
  onFinalTranscript,
}: {
  lang?: string;
  onFinalTranscript: (text: string) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<LiveTranscriptionStatus>(() =>
    getSpeechRecognitionConstructor() ? "idle" : "unsupported",
  );
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.stop();
    }
    setStatus((current) => (current === "unsupported" ? current : "idle"));
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setStatus("unsupported");
      setError("当前运行环境不支持实时语音转写");
      return false;
    }

    setStatus("requesting");
    setError(null);
    let granted = false;
    try {
      granted = await requestMicrophoneAccess();
    } catch {
      granted = false;
    }
    if (!granted) {
      setStatus("error");
      setError("麦克风权限未授权");
      return false;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.onresult = (event) => {
      const text = collectFinalTranscript(event);
      if (text) void onFinalTranscriptRef.current(text);
    };
    recognition.onerror = (event) => {
      setError(event.error ? `语音转写失败：${event.error}` : "语音转写失败");
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setStatus("error");
      }
    };
    recognition.onend = () => {
      if (!shouldListenRef.current) {
        setStatus("idle");
        return;
      }
      try {
        recognition.start();
      } catch {
        setStatus("error");
      }
    };

    shouldListenRef.current = true;
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setStatus("listening");
      return true;
    } catch {
      shouldListenRef.current = false;
      recognitionRef.current = null;
      setStatus("error");
      setError("语音转写启动失败");
      return false;
    }
  }, [lang]);

  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return {
    status,
    error,
    isListening: status === "listening",
    isSupported: status !== "unsupported",
    start,
    stop,
  };
}
