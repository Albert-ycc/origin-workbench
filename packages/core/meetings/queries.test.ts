import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiInstance } from "../api";
import type { ApiClient } from "../api";
import type {
  ListMeetingASRJobsResponse,
  ListMeetingTranscriptSegmentsResponse,
  MeetingASRJob,
  MeetingTranscriptSegment,
} from "../types";
import { meetingASRJobOptions, meetingTranscriptOptions } from "./queries";

function asrJob(overrides: Partial<MeetingASRJob> = {}): MeetingASRJob {
  return {
    id: "job-1",
    workspace_id: "ws-1",
    project_id: "project-1",
    meeting_id: "meeting-1",
    audio_asset_id: "asset-1",
    provider: "local",
    status: "running",
    error_message: "",
    retry_count: 0,
    source_seq_start: null,
    source_seq_end: null,
    created_at: "2026-05-24T00:00:00Z",
    updated_at: "2026-05-24T00:00:00Z",
    ...overrides,
  };
}

describe("meetingASRJobOptions", () => {
  it("polls while a background ASR job is still active", () => {
    const options = meetingASRJobOptions("ws-1", "meeting-1");
    const refetchInterval = options.refetchInterval as (query: {
      state: { data?: ListMeetingASRJobsResponse };
    }) => number | false;

    expect(
      refetchInterval({
        state: { data: { jobs: [asrJob({ status: "running" })], total: 1 } },
      }),
    ).toBe(2000);
    expect(
      refetchInterval({
        state: { data: { jobs: [asrJob({ status: "queued" })], total: 1 } },
      }),
    ).toBe(2000);
    expect(
      refetchInterval({
        state: { data: { jobs: [asrJob({ status: "completed" })], total: 1 } },
      }),
    ).toBe(false);
  });
});

function transcriptSegment(overrides: Partial<MeetingTranscriptSegment> = {}): MeetingTranscriptSegment {
  return {
    id: "segment-1",
    workspace_id: "ws-1",
    project_id: "project-1",
    meeting_id: "meeting-1",
    seq: 1,
    started_at: null,
    ended_at: null,
    speaker_label: "客户",
    text: "转写",
    confidence: 0.9,
    audio_offset_ms: null,
    source: "manual",
    created_at: "2026-05-24T00:00:00Z",
    updated_at: "2026-05-24T00:00:00Z",
    deleted_at: null,
    edit_revision: 0,
    ...overrides,
  };
}

describe("meetingTranscriptOptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("paginates transcript segments until the backend returns fewer than the page limit", async () => {
    const page1: ListMeetingTranscriptSegmentsResponse = {
      segments: Array.from({ length: 1000 }, (_, index) =>
        transcriptSegment({ id: `segment-${index + 1}`, seq: index + 1 }),
      ),
      total: 1000,
    };
    const page2: ListMeetingTranscriptSegmentsResponse = {
      segments: [transcriptSegment({ id: "segment-1001", seq: 1001, text: "第1001段" })],
      total: 1,
    };
    const listMeetingTranscriptSegments = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    setApiInstance({
      listMeetingTranscriptSegments,
    } as unknown as ApiClient);

    const options = meetingTranscriptOptions("ws-1", "meeting-1");
    const result = await options.queryFn!({} as never);

    expect(listMeetingTranscriptSegments).toHaveBeenNthCalledWith(1, "meeting-1", {
      after_seq: 0,
      limit: 1000,
    });
    expect(listMeetingTranscriptSegments).toHaveBeenNthCalledWith(2, "meeting-1", {
      after_seq: 1000,
      limit: 1000,
    });
    expect(result.segments).toHaveLength(1001);
    expect(result.segments.at(-1)?.text).toBe("第1001段");
    expect(result.total).toBe(1001);
  });
});
