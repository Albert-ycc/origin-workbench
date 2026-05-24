import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectFinalTranscript,
  collectSpeechRecognitionTranscript,
  useLiveTranscription,
} from "./live-transcription";

describe("collectFinalTranscript", () => {
  it("joins final speech recognition alternatives from resultIndex onward", () => {
    const event = {
      resultIndex: 1,
      results: [
        { isFinal: true, 0: { transcript: "忽略旧结果" } },
        { isFinal: false, 0: { transcript: "临时文本" } },
        { isFinal: true, 0: { transcript: "这个版本既要月底上线" } },
        { isFinal: true, 0: { transcript: "又要风险清零" } },
      ],
    };

    expect(collectFinalTranscript(event)).toBe("这个版本既要月底上线 又要风险清零");
  });
});

describe("collectSpeechRecognitionTranscript", () => {
  it("separates final and interim speech recognition text from resultIndex onward", () => {
    const event = {
      resultIndex: 1,
      results: [
        { isFinal: true, 0: { transcript: "忽略旧结果" } },
        { isFinal: false, 0: { transcript: "正在识别中的内容" } },
        { isFinal: true, 0: { transcript: "已经确认的内容" } },
      ],
    };

    expect(collectSpeechRecognitionTranscript(event)).toEqual({
      finalText: "已经确认的内容",
      interimText: "正在识别中的内容",
    });
  });
});

class MockSpeechRecognition {
  static lastInstance: MockSpeechRecognition | null = null;

  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onerror = null;
  onend = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    MockSpeechRecognition.lastInstance = this;
  }
}

describe("useLiveTranscription", () => {
  afterEach(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "desktopAPI", {
      configurable: true,
      value: undefined,
    });
    MockSpeechRecognition.lastInstance = null;
    vi.restoreAllMocks();
  });

  it("streams interim text without persisting it before a final result", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(window, "desktopAPI", {
      configurable: true,
      value: {
        getMicrophonePermissionStatus: vi.fn().mockResolvedValue("granted"),
      },
    });
    const onFinalTranscript = vi.fn();

    const { result } = renderHook(() =>
      useLiveTranscription({
        onFinalTranscript,
      }),
    );

    await act(async () => {
      await expect(result.current.start()).resolves.toBe(true);
    });

    expect(MockSpeechRecognition.lastInstance?.interimResults).toBe(true);

    act(() => {
      MockSpeechRecognition.lastInstance?.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: false, 0: { transcript: "正在流式识别" } }],
      });
    });

    expect(result.current.interimTranscript).toBe("正在流式识别");
    expect(onFinalTranscript).not.toHaveBeenCalled();

    act(() => {
      MockSpeechRecognition.lastInstance?.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "已经确认入库" } }],
      });
    });

    expect(result.current.interimTranscript).toBe("");
    expect(onFinalTranscript).toHaveBeenCalledWith("已经确认入库");
  });

  it("clears microphone permission errors when reset", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(window, "desktopAPI", {
      configurable: true,
      value: {
        getMicrophonePermissionStatus: vi.fn().mockResolvedValue("denied"),
      },
    });

    const { result } = renderHook(() =>
      useLiveTranscription({
        onFinalTranscript: vi.fn(),
      }),
    );

    await act(async () => {
      await expect(result.current.start()).resolves.toBe(false);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("麦克风权限未授权");

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });
});
