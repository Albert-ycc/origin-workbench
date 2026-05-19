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

export type SpeechRecognitionTranscript = {
  finalText: string;
  interimText: string;
};

export function collectSpeechRecognitionTranscript(
  event: SpeechRecognitionEventLike,
): SpeechRecognitionTranscript {
  const finalParts: string[] = [];
  const interimParts: string[] = [];
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const text = result?.[0]?.transcript?.trim();
    if (!text) continue;
    if (result?.isFinal) {
      finalParts.push(text);
    } else {
      interimParts.push(text);
    }
  }
  return {
    finalText: finalParts.join(" ").trim(),
    interimText: interimParts.join(" ").trim(),
  };
}

export function collectFinalTranscript(event: SpeechRecognitionEventLike): string {
  return collectSpeechRecognitionTranscript(event).finalText;
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
  const [interimTranscript, setInterimTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    setInterimTranscript("");
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

  const reset = useCallback(() => {
    shouldListenRef.current = false;
    setInterimTranscript("");
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.abort();
    }
    setError(null);
    setStatus(getSpeechRecognitionConstructor() ? "idle" : "unsupported");
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    const Recognition = getSpeechRecognitionConstructor();
    setInterimTranscript("");
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
      const { finalText, interimText } = collectSpeechRecognitionTranscript(event);
      setInterimTranscript(interimText);
      if (finalText) void onFinalTranscriptRef.current(finalText);
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
    interimTranscript,
    isListening: status === "listening",
    isSupported: status !== "unsupported",
    start,
    stop,
    reset,
  };
}
