import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMeetingAudioFileName,
  pickMeetingAudioMimeType,
  useMeetingAudioRecorder,
} from "./audio-recorder";

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported = vi.fn((mimeType: string) => mimeType === "audio/webm;codecs=opus");

  state: RecordingState = "inactive";
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["audio"], { type: this.mimeType || "audio/webm" }),
    } as BlobEvent);
    this.onstop?.(new Event("stop"));
  });

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "";
    MockMediaRecorder.instances.push(this);
  }
}

function installMediaRecorderMocks() {
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: stopTrack }],
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:meeting-audio"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  return { getUserMedia, stopTrack };
}

describe("meeting audio recorder helpers", () => {
  afterEach(() => {
    MockMediaRecorder.instances = [];
    MockMediaRecorder.isTypeSupported.mockClear();
    vi.unstubAllGlobals();
  });

  it("picks a supported browser recording format", () => {
    installMediaRecorderMocks();

    expect(pickMeetingAudioMimeType()).toBe("audio/webm;codecs=opus");
  });

  it("builds a filesystem-safe recording file name", () => {
    expect(
      buildMeetingAudioFileName(
        "客户/访谈: 第一轮",
        new Date(2026, 4, 24, 10, 20, 30),
        "audio/webm;codecs=opus",
      ),
    ).toBe("客户-访谈-第一轮-20260524-102030.webm");
  });
});

describe("useMeetingAudioRecorder", () => {
  afterEach(() => {
    MockMediaRecorder.instances = [];
    MockMediaRecorder.isTypeSupported.mockClear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports unsupported environments without requesting the microphone", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal("MediaRecorder", undefined);

    const { result } = renderHook(() => useMeetingAudioRecorder());

    await act(async () => {
      await expect(result.current.start()).resolves.toBe(false);
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("当前运行环境不支持录音保存");
  });

  it("records microphone audio into a downloadable blob", async () => {
    const { getUserMedia, stopTrack } = installMediaRecorderMocks();
    const { result } = renderHook(() => useMeetingAudioRecorder());

    await act(async () => {
      await expect(result.current.start()).resolves.toBe(true);
    });

    expect(result.current.state).toBe("recording");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(MockMediaRecorder.instances[0]?.mimeType).toBe("audio/webm;codecs=opus");

    act(() => {
      result.current.stop();
    });

    expect(stopTrack).toHaveBeenCalled();
    expect(result.current.state).toBe("ready");
    expect(result.current.recording?.url).toBe("blob:meeting-audio");
    expect(result.current.recording?.blob.type).toBe("audio/webm;codecs=opus");
  });

  it("releases the generated object URL on reset", async () => {
    installMediaRecorderMocks();
    const { result } = renderHook(() => useMeetingAudioRecorder());

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.stop();
    });
    act(() => {
      result.current.reset();
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:meeting-audio");
    expect(result.current.state).toBe("idle");
    expect(result.current.recording).toBeNull();
  });
});
