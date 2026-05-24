import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  AudioRecorderPanel,
  MeetingAudioAssetHistory,
  MeetingASRStatusNotice,
  TranscriptFeed,
  groupMeetingAudioHistory,
  meetingDangerActions,
  meetingDangerConfirmations,
  meetingBackupSurfaces,
  meetingNavigationCopy,
  meetingPrimaryActions,
  meetingPrimarySurfaces,
  meetingSecondaryActions,
  meetingTranscriptionAsideCopy,
  SourceImportPanel,
  SummaryPanel,
  splitTranscriptText,
} from "./meetings-page";
import type { MeetingAudioRecorderController } from "./audio-recorder";
import type {
  MeetingASRJob,
  MeetingASRStatus,
  MeetingAudioAsset,
  MeetingSummary,
  MeetingTranscriptSegment,
} from "@multica/core/types";

function createRecorderStub(
  overrides: Partial<MeetingAudioRecorderController> = {},
): MeetingAudioRecorderController {
  return {
    state: "idle",
    error: null,
    elapsedSeconds: 0,
    recording: null,
    start: async () => true,
    stop: () => {},
    reset: () => {},
    ...overrides,
  };
}

function createSummary(overrides: Partial<MeetingSummary> = {}): MeetingSummary {
  return {
    meeting_id: "meeting-1",
    workspace_id: "ws-1",
    project_id: "project-1",
    summary_md: "关键词纪要：讨论了上线风险和待办。",
    decisions: [],
    questions: [],
    risks: [],
    feedback: [],
    tensions: [],
    action_items: [],
    memory_candidates: [],
    source_seq_start: 1,
    source_seq_end: 3,
    generated_by: "rules",
    duration_seconds: 120,
    created_at: "2026-05-24T00:00:00Z",
    updated_at: "2026-05-24T00:00:00Z",
    ...overrides,
  };
}

function createASRStatus(
  overrides: Partial<MeetingASRStatus["local"]> = {},
  externalOverrides: Partial<MeetingASRStatus["external"]> = {},
): MeetingASRStatus {
  return {
    local: {
      configured: false,
      available: false,
      timeout_seconds: 600,
      error: "local ASR command not configured",
      ...overrides,
    },
    external: {
      configured: false,
      available: false,
      timeout_seconds: 600,
      error: "external ASR endpoint not configured",
      ...externalOverrides,
    },
  };
}

function createAudioAsset(overrides: Partial<MeetingAudioAsset> = {}): MeetingAudioAsset {
  return {
    id: "asset-1",
    workspace_id: "ws-1",
    project_id: "project-1",
    meeting_id: "meeting-1",
    filename: "产品例会.webm",
    url: "/uploads/meeting.webm",
    download_url: "/uploads/meeting.webm",
    content_type: "audio/webm",
    size_bytes: 1024,
    duration_seconds: 65,
    status: "available",
    created_by_user_id: "user-1",
    created_at: "2026-05-24T00:00:00Z",
    updated_at: "2026-05-24T00:00:00Z",
    ...overrides,
  };
}

function createASRJob(overrides: Partial<MeetingASRJob> = {}): MeetingASRJob {
  return {
    id: "job-1",
    workspace_id: "ws-1",
    project_id: "project-1",
    meeting_id: "meeting-1",
    audio_asset_id: "asset-1",
    provider: "local",
    status: "completed",
    error_message: "",
    retry_count: 0,
    source_seq_start: 1,
    source_seq_end: 2,
    created_at: "2026-05-24T00:00:00Z",
    updated_at: "2026-05-24T00:00:00Z",
    ...overrides,
  };
}

function createTranscriptSegment(
  overrides: Partial<MeetingTranscriptSegment> = {},
): MeetingTranscriptSegment {
  return {
    id: "segment-1",
    workspace_id: "ws-1",
    project_id: "project-1",
    meeting_id: "meeting-1",
    seq: 7,
    started_at: null,
    ended_at: null,
    speaker_label: "客户",
    text: "确认优先修复录音转写阻塞",
    confidence: 0.96,
    audio_offset_ms: null,
    source: "manual",
    created_at: "2026-05-24T00:00:00Z",
    updated_at: "2026-05-24T00:00:00Z",
    deleted_at: null,
    edit_revision: 0,
    ...overrides,
  };
}

describe("MeetingsPage IA", () => {
  it("keeps the meeting detail focused on live process surfaces", () => {
    expect(meetingPrimarySurfaces).toEqual(["实时转写流", "关键洞察 / 旁听提示"]);
    expect(meetingBackupSurfaces).toEqual(["临时录音"]);
  });

  it("uses meeting as the navigation concept and keeps Copilot as capability copy", () => {
    expect(meetingNavigationCopy).toEqual({
      routeTitle: "会议",
      globalTitle: "会议工作台",
      projectTitle: "项目会议",
      capabilitySubtitle: "会议 Copilot 能力用于录音转写、Agent 旁听分析和会后沉淀",
    });
  });

  it("keeps only start and stop as primary meeting detail actions", () => {
    expect(meetingPrimaryActions).toEqual(["开始", "结束"]);
  });

  it("describes local ASR as post-recording transcription instead of unavailable realtime", () => {
    expect(meetingTranscriptionAsideCopy("local", "unsupported")).toBe("录音保存后转写");
    expect(meetingTranscriptionAsideCopy("external", "idle")).toBe("外部转写待接入");
    expect(meetingTranscriptionAsideCopy("manual", "idle")).toBe("手动记录");
  });

  it("moves secondary meeting actions out of the detail first screen", () => {
    expect(meetingSecondaryActions).toEqual(["会议设置", "导入转写", "纪要生成 / 查看"]);
    expect(meetingDangerActions).toEqual(["归档", "删除"]);
  });

  it("uses AlertDialog for destructive meeting actions", () => {
    expect(meetingDangerConfirmations).toEqual({
      meetingDelete: "alert-dialog",
    });
  });

  it("keeps imported transcript text in a bounded scrollable editor", () => {
    render(
      createElement(SourceImportPanel, {
        text: Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 行转写`).join("\n"),
        onTextChange: () => {},
        onUploadClick: () => {},
        onSave: () => {},
        disabled: false,
      }),
    );

    const editor = screen.getByPlaceholderText("粘贴会议文件转写内容，保存后按段落写入本场会议");
    expect(editor).toHaveClass("[field-sizing:fixed]");
    expect(editor).toHaveClass("h-40");
    expect(editor).toHaveClass("max-h-40");
    expect(editor).toHaveClass("overflow-y-auto");
  });

  it("keeps every imported transcript segment beyond the first 50", () => {
    const input = Array.from({ length: 75 }, (_, index) => `第 ${index + 1} 段转写`).join("\n");

    const segments = splitTranscriptText(input);

    expect(segments).toHaveLength(75);
    expect(segments[0]).toBe("第 1 段转写");
    expect(segments[74]).toBe("第 75 段转写");
  });

  it("tells users recording backup is temporary until they save it", () => {
    render(
      createElement(AudioRecorderPanel, {
        meetingTitle: "产品例会",
        recorder: createRecorderStub(),
        disabled: false,
        realtimeUnavailable: false,
      }),
    );

    expect(screen.getByText("临时录音")).toBeInTheDocument();
    expect(screen.getByText(/停止后先保存到会议，下载副本只是本地兜底/)).toBeInTheDocument();
  });

  it("states the system audio boundary for meeting recordings", () => {
    render(
      createElement(AudioRecorderPanel, {
        meetingTitle: "产品例会",
        recorder: createRecorderStub(),
        disabled: false,
        realtimeUnavailable: false,
      }),
    );

    expect(screen.getByText(/当前只录麦克风，不捕获系统声音或会议软件扬声器音频/)).toBeInTheDocument();
  });

  it("saves a ready temporary recording to the meeting before local download fallback", () => {
    const onSaveToMeeting = vi.fn();
    const blob = new Blob(["audio"], { type: "audio/webm" });
    render(
      createElement(AudioRecorderPanel, {
        meetingTitle: "产品例会",
        recorder: createRecorderStub({
          state: "ready",
          recording: {
            blob,
            url: "blob:meeting",
            mimeType: "audio/webm",
            startedAt: new Date("2026-05-24T08:00:00Z"),
            durationSeconds: 4,
          },
        }),
        disabled: false,
        realtimeUnavailable: false,
        saveStatus: "idle",
        savedAssetName: null,
        onSaveToMeeting,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /保存到会议/ }));

    expect(onSaveToMeeting).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /下载副本/ })).toBeInTheDocument();
  });

  it("shows ASR job failure and exposes retry without hiding manual fallback", () => {
    const onRetryASRJob = vi.fn();
    render(
      createElement(AudioRecorderPanel, {
        meetingTitle: "产品例会",
        recorder: createRecorderStub(),
        disabled: false,
        realtimeUnavailable: true,
        asrJobStatus: "failed",
        asrJobError: "ASR provider local not configured",
        onRetryASRJob,
      }),
    );

    expect(screen.getByText(/自动转写失败/)).toBeInTheDocument();
    expect(screen.getByText(/ASR provider local not configured/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /重试转写/ }));

    expect(onRetryASRJob).toHaveBeenCalledTimes(1);
  });

  it("shows appended transcript range for completed ASR jobs without retry", () => {
    const onRetryASRJob = vi.fn();
    render(
      createElement(AudioRecorderPanel, {
        meetingTitle: "产品例会",
        recorder: createRecorderStub(),
        disabled: false,
        realtimeUnavailable: false,
        asrJobStatus: "completed",
        asrJobSourceSeqStart: 3,
        asrJobSourceSeqEnd: 5,
        onRetryASRJob,
      }),
    );

    expect(screen.getByText("自动转写已完成，已追加 3-5 段转写")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重试转写/ })).not.toBeInTheDocument();
  });

  it("shows local ASR health in meeting settings copy", () => {
    const { rerender } = render(
      createElement(MeetingASRStatusNotice, {
        selectedProvider: "local",
        status: createASRStatus(),
      }),
    );

    expect(screen.getByText(/本地模型未配置/)).toBeInTheDocument();
    expect(screen.getByText(/local ASR command not configured/)).toBeInTheDocument();

    rerender(
      createElement(MeetingASRStatusNotice, {
        selectedProvider: "local",
        status: createASRStatus({
          configured: true,
          available: true,
          command_name: "whisper-cli",
          timeout_seconds: 120,
          error: "",
        }),
      }),
    );

    expect(screen.getByText(/本地模型可用/)).toBeInTheDocument();
    expect(screen.getByText(/whisper-cli/)).toBeInTheDocument();
  });

  it("shows external ASR health in meeting settings copy", () => {
    const { rerender } = render(
      createElement(MeetingASRStatusNotice, {
        selectedProvider: "external",
        status: createASRStatus(),
      }),
    );

    expect(screen.getByText(/外部服务未配置/)).toBeInTheDocument();
    expect(screen.getByText(/external ASR endpoint not configured/)).toBeInTheDocument();

    rerender(
      createElement(MeetingASRStatusNotice, {
        selectedProvider: "external",
        status: createASRStatus(
          {},
          {
            configured: true,
            available: true,
            command_name: "asr-gateway",
            timeout_seconds: 90,
            error: "",
          },
        ),
      }),
    );

    expect(screen.getByText(/外部服务可用/)).toBeInTheDocument();
    expect(screen.getByText(/asr-gateway/)).toBeInTheDocument();
  });

  it("shows saved recording and ASR job history after refresh", () => {
    render(
      createElement(MeetingAudioAssetHistory, {
        assets: [createAudioAsset()],
        jobs: [createASRJob()],
      }),
    );

    expect(screen.getByText("已保存录音")).toBeInTheDocument();
    expect(screen.getByText("产品例会.webm")).toBeInTheDocument();
    expect(screen.getByText(/自动转写已完成/)).toBeInTheDocument();
    expect(screen.getByText(/1-2 段/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /下载/ })).toHaveAttribute(
      "href",
      "/uploads/meeting.webm",
    );
  });

  it("shows all saved recordings and uses the newest ASR job for each asset", () => {
    const onRetryASRJob = vi.fn();
    const assets = Array.from({ length: 4 }, (_, index) =>
      createAudioAsset({
        id: `asset-${index + 1}`,
        filename: `录音-${index + 1}.webm`,
      }),
    );
    const olderJob = createASRJob({
      id: "job-old",
      audio_asset_id: "asset-1",
      status: "completed",
      updated_at: "2026-05-24T00:00:00Z",
    });
    const latestJob = createASRJob({
      id: "job-new",
      audio_asset_id: "asset-1",
      status: "failed",
      error_message: "external timeout",
      updated_at: "2026-05-24T00:10:00Z",
    });

    expect(groupMeetingAudioHistory([assets[0]!], [olderJob, latestJob])[0]?.latestJob?.id).toBe(
      "job-new",
    );

    render(
      createElement(MeetingAudioAssetHistory, {
        assets,
        jobs: [olderJob, latestJob],
        onRetryASRJob,
      }),
    );

    expect(screen.getByText("录音-4.webm")).toBeInTheDocument();
    expect(screen.getByText(/自动转写失败：external timeout，共 2 次转写任务/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /重试/ }));

    expect(onRetryASRJob).toHaveBeenCalledWith("job-new");
  });

  it("exposes retry and delete actions for saved recording history", () => {
    const onRetryASRJob = vi.fn();
    const onDeleteAudioAsset = vi.fn();
    render(
      createElement(MeetingAudioAssetHistory, {
        assets: [createAudioAsset()],
        jobs: [createASRJob({ status: "failed", error_message: "local ASR command failed" })],
        onRetryASRJob,
        onDeleteAudioAsset,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));

    expect(onRetryASRJob).toHaveBeenCalledWith("job-1");
    expect(onDeleteAudioAsset).toHaveBeenCalledWith("asset-1");
  });

  it("shows an actionable next step when recording enters error state", () => {
    render(
      createElement(AudioRecorderPanel, {
        meetingTitle: "产品例会",
        recorder: createRecorderStub({
          state: "error",
          error: "未找到可用麦克风",
        }),
        disabled: false,
        realtimeUnavailable: false,
        saveStatus: "idle",
        savedAssetName: null,
        onSaveToMeeting: undefined,
      }),
    );

    expect(screen.getByText(/未找到可用麦克风/)).toBeInTheDocument();
    expect(screen.getByText(/检查系统麦克风权限或外接麦克风，也可继续手动记录/)).toBeInTheDocument();
  });

  it("labels generated summaries as rule drafts that need human review", () => {
    render(
      createElement(SummaryPanel, {
        summary: createSummary(),
        segmentCount: 3,
        pending: false,
        onGenerate: () => {},
      }),
    );

    expect(screen.getByText("规则草稿")).toBeInTheDocument();
    expect(screen.getByText(/需人工复核/)).toBeInTheDocument();
  });

  it("links summary items back to their transcript source segment", () => {
    const onSelectEvidenceSeq = vi.fn();
    render(
      createElement(SummaryPanel, {
        summary: createSummary({
          decisions: ["客户：确认优先修复录音转写阻塞"],
        }),
        segmentCount: 1,
        pending: false,
        transcriptSegments: [createTranscriptSegment()],
        onGenerate: () => {},
        onSelectEvidenceSeq,
      }),
    );

    expect(screen.getByText("转写依据")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /第 7 段/ }));

    expect(onSelectEvidenceSeq).toHaveBeenCalledWith(7);
  });

  it("supports transcript segment edit, delete, split, and merge actions", () => {
    const onUpdateSegment = vi.fn();
    const onDeleteSegment = vi.fn();
    const onSplitSegment = vi.fn();
    const onMergeSegment = vi.fn();
    render(
      createElement(TranscriptFeed, {
        segments: [
          createTranscriptSegment({
            id: "segment-1",
            seq: 1,
            text: "第一句\n第二句",
          }),
          createTranscriptSegment({
            id: "segment-2",
            seq: 2,
            text: "第三句",
          }),
        ],
        highlightedSeq: null,
        interimTranscript: "",
        onUpdateSegment,
        onDeleteSegment,
        onSplitSegment,
        onMergeSegment,
      }),
    );

    fireEvent.click(screen.getByLabelText("编辑第 1 段转写"));
    fireEvent.change(screen.getByLabelText("转写内容"), {
      target: { value: "更新后的转写" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onUpdateSegment).toHaveBeenCalledWith("segment-1", {
      speaker_label: "客户",
      text: "更新后的转写",
    });

    fireEvent.click(screen.getByLabelText("拆分第 1 段转写"));
    expect(onSplitSegment).toHaveBeenCalledWith("segment-1", {
      text_before: "第一句",
      text_after: "第二句",
    });

    fireEvent.click(screen.getByLabelText("合并第 1 段和第 2 段转写"));
    expect(onMergeSegment).toHaveBeenCalledWith("segment-1", "segment-2");

    fireEvent.click(screen.getByLabelText("删除第 1 段转写"));
    expect(onDeleteSegment).toHaveBeenCalledWith("segment-1");
  });
});
