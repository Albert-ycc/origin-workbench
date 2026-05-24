// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiInstance } from "../api";
import type { ApiClient } from "../api";
import type {
  ListMeetingAudioAssetsResponse,
  ListMeetingASRJobsResponse,
  ListMeetingTranscriptSegmentsResponse,
  MeetingASRJob,
  MeetingAudioAsset,
  MeetingTranscriptSegment,
} from "../types";
import {
  useCreateMeetingASRJob,
  useCreateMeetingTranscriptSegment,
  useDeleteMeetingAudioAsset,
  useDeleteMeetingTranscriptSegment,
  useMergeMeetingTranscriptSegments,
  useRetryMeetingASRJob,
  useSaveMeetingAudioAsset,
  useSplitMeetingTranscriptSegment,
  useUpdateMeetingTranscriptSegment,
} from "./mutations";
import { meetingKeys } from "./queries";

const wsId = "ws-1";
const meetingId = "meeting-1";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function segment(overrides: Partial<MeetingTranscriptSegment>): MeetingTranscriptSegment {
  return {
    id: "segment-1",
    workspace_id: wsId,
    project_id: "project-1",
    meeting_id: meetingId,
    seq: 1,
    started_at: null,
    ended_at: null,
    speaker_label: "User",
    text: "hello",
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

function audioAsset(overrides: Partial<MeetingAudioAsset> = {}): MeetingAudioAsset {
  return {
    id: "asset-1",
    workspace_id: wsId,
    project_id: "project-1",
    meeting_id: meetingId,
    filename: "meeting.webm",
    url: "https://cdn.example.com/meeting.webm",
    download_url: "https://cdn.example.com/meeting.webm",
    content_type: "audio/webm",
    size_bytes: 123,
    duration_seconds: 4,
    status: "available",
    created_by_user_id: "user-1",
    created_at: "2026-05-24T00:00:00Z",
    updated_at: "2026-05-24T00:00:00Z",
    ...overrides,
  };
}

function asrJob(overrides: Partial<MeetingASRJob> = {}): MeetingASRJob {
  return {
    id: "job-1",
    workspace_id: wsId,
    project_id: "project-1",
    meeting_id: meetingId,
    audio_asset_id: "asset-1",
    provider: "local",
    status: "failed",
    error_message: "ASR provider local not configured",
    retry_count: 0,
    source_seq_start: null,
    source_seq_end: null,
    created_at: "2026-05-24T00:00:00Z",
    updated_at: "2026-05-24T00:00:00Z",
    ...overrides,
  };
}

describe("useCreateMeetingTranscriptSegment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the created transcript segment into the transcript query cache immediately", async () => {
    const qc = createQueryClient();
    const existingSegment = segment({ id: "segment-2", seq: 2, text: "second" });
    const createdSegment = segment({ id: "segment-1", seq: 1, text: "first" });
    qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
      {
        segments: [existingSegment],
        total: 1,
      },
    );
    const createMeetingTranscriptSegment = vi.fn().mockResolvedValue(createdSegment);
    setApiInstance({
      createMeetingTranscriptSegment,
    } as unknown as ApiClient);

    const { result } = renderHook(() => useCreateMeetingTranscriptSegment(wsId), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({
      meetingId,
      data: { speaker_label: "User", text: "first", source: "manual" },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(createMeetingTranscriptSegment).toHaveBeenCalledWith(meetingId, {
      speaker_label: "User",
      text: "first",
      source: "manual",
    });
    expect(qc.getQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
    )).toEqual({
      segments: [createdSegment, existingSegment],
      total: 2,
    });
  });
});

describe("transcript segment edit mutations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates edited transcript segments in the transcript query cache", async () => {
    const qc = createQueryClient();
    const existingSegment = segment({ id: "segment-1", text: "before", edit_revision: 0 });
    const updatedSegment = segment({ id: "segment-1", text: "after", edit_revision: 1 });
    qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
      { segments: [existingSegment], total: 1 },
    );
    qc.setQueryData(meetingKeys.summary(wsId, meetingId), { meeting_id: meetingId });
    const updateMeetingTranscriptSegment = vi.fn().mockResolvedValue(updatedSegment);
    setApiInstance({
      updateMeetingTranscriptSegment,
    } as unknown as ApiClient);

    const { result } = renderHook(() => useUpdateMeetingTranscriptSegment(wsId), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({
      meetingId,
      segmentId: "segment-1",
      data: { speaker_label: "User", text: "after" },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(updateMeetingTranscriptSegment).toHaveBeenCalledWith(meetingId, "segment-1", {
      speaker_label: "User",
      text: "after",
    });
    expect(qc.getQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
    )).toEqual({ segments: [updatedSegment], total: 1 });
    expect(qc.getQueryState(meetingKeys.summary(wsId, meetingId))?.isInvalidated).toBe(true);
  });

  it("removes deleted transcript segments from the transcript query cache", async () => {
    const qc = createQueryClient();
    const deletedSegment = segment({ id: "segment-1", seq: 1 });
    const remainingSegment = segment({ id: "segment-2", seq: 2 });
    qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
      { segments: [deletedSegment, remainingSegment], total: 2 },
    );
    const deleteMeetingTranscriptSegment = vi.fn().mockResolvedValue(undefined);
    setApiInstance({
      deleteMeetingTranscriptSegment,
    } as unknown as ApiClient);

    const { result } = renderHook(() => useDeleteMeetingTranscriptSegment(wsId), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({ meetingId, segmentId: "segment-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(deleteMeetingTranscriptSegment).toHaveBeenCalledWith(meetingId, "segment-1");
    expect(qc.getQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
    )).toEqual({ segments: [remainingSegment], total: 1 });
  });

  it("merges split transcript response segments back in sequence order", async () => {
    const qc = createQueryClient();
    const original = segment({ id: "segment-1", seq: 1, text: "old" });
    const shifted = segment({ id: "segment-2", seq: 3, text: "third" });
    const before = segment({ id: "segment-1", seq: 1, text: "before", edit_revision: 1 });
    const after = segment({ id: "segment-new", seq: 2, text: "after" });
    qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
      { segments: [original, shifted], total: 2 },
    );
    const splitMeetingTranscriptSegment = vi.fn().mockResolvedValue({ segments: [before, after] });
    setApiInstance({
      splitMeetingTranscriptSegment,
    } as unknown as ApiClient);

    const { result } = renderHook(() => useSplitMeetingTranscriptSegment(wsId), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({
      meetingId,
      segmentId: "segment-1",
      data: { text_before: "before", text_after: "after" },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(splitMeetingTranscriptSegment).toHaveBeenCalledWith(meetingId, "segment-1", {
      text_before: "before",
      text_after: "after",
    });
    expect(qc.getQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
    )).toEqual({ segments: [before, after, shifted], total: 3 });
  });

  it("replaces the kept segment and removes the deleted segment after merge", async () => {
    const qc = createQueryClient();
    const first = segment({ id: "segment-1", seq: 1, text: "first" });
    const second = segment({ id: "segment-2", seq: 2, text: "second" });
    const merged = segment({ id: "segment-1", seq: 1, text: "first\nsecond", edit_revision: 1 });
    qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
      { segments: [first, second], total: 2 },
    );
    const mergeMeetingTranscriptSegments = vi.fn().mockResolvedValue({
      segment: merged,
      deleted_segment_id: "segment-2",
    });
    setApiInstance({
      mergeMeetingTranscriptSegments,
    } as unknown as ApiClient);

    const { result } = renderHook(() => useMergeMeetingTranscriptSegments(wsId), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({
      meetingId,
      segmentId: "segment-1",
      data: { target_segment_id: "segment-2" },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mergeMeetingTranscriptSegments).toHaveBeenCalledWith(meetingId, "segment-1", {
      target_segment_id: "segment-2",
    });
    expect(qc.getQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
    )).toEqual({ segments: [merged], total: 1 });
  });
});

describe("meeting ASR job mutations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes created ASR jobs into the ASR job query cache immediately", async () => {
    const qc = createQueryClient();
    const existingJob = asrJob({ id: "job-2", audio_asset_id: "asset-2" });
    const createdJob = asrJob({ id: "job-1", audio_asset_id: "asset-1" });
    qc.setQueryData<ListMeetingASRJobsResponse>(meetingKeys.asrJobs(wsId, meetingId), {
      jobs: [existingJob],
      total: 1,
    });
    const createMeetingASRJob = vi.fn().mockResolvedValue(createdJob);
    setApiInstance({
      createMeetingASRJob,
    } as unknown as ApiClient);

    const { result } = renderHook(() => useCreateMeetingASRJob(wsId), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({
      meetingId,
      audioAssetId: "asset-1",
      data: { provider: "local" },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(createMeetingASRJob).toHaveBeenCalledWith(meetingId, "asset-1", {
      provider: "local",
    });
    expect(qc.getQueryData<ListMeetingASRJobsResponse>(
      meetingKeys.asrJobs(wsId, meetingId),
    )).toEqual({
      jobs: [createdJob, existingJob],
      total: 2,
    });
  });

  it("invalidates transcript segments when a created ASR job completes", async () => {
    const qc = createQueryClient();
    qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
      meetingKeys.transcript(wsId, meetingId),
      { segments: [], total: 0 },
    );
    const completedJob = asrJob({
      id: "job-1",
      status: "completed",
      error_message: "",
      source_seq_start: 1,
      source_seq_end: 2,
    });
    const createMeetingASRJob = vi.fn().mockResolvedValue(completedJob);
    setApiInstance({
      createMeetingASRJob,
    } as unknown as ApiClient);

    const { result } = renderHook(() => useCreateMeetingASRJob(wsId), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({
      meetingId,
      audioAssetId: "asset-1",
      data: { provider: "local" },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryState(meetingKeys.transcript(wsId, meetingId))?.isInvalidated).toBe(true);
  });

  it("updates retried ASR jobs in the ASR job query cache", async () => {
    const qc = createQueryClient();
    const existingJob = asrJob({ id: "job-1", retry_count: 0 });
    const retriedJob = asrJob({ id: "job-1", retry_count: 1 });
    qc.setQueryData<ListMeetingASRJobsResponse>(meetingKeys.asrJobs(wsId, meetingId), {
      jobs: [existingJob],
      total: 1,
    });
    const retryMeetingASRJob = vi.fn().mockResolvedValue(retriedJob);
    setApiInstance({
      retryMeetingASRJob,
    } as unknown as ApiClient);

    const { result } = renderHook(() => useRetryMeetingASRJob(wsId), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({ meetingId, jobId: "job-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(retryMeetingASRJob).toHaveBeenCalledWith(meetingId, "job-1");
    expect(qc.getQueryData<ListMeetingASRJobsResponse>(
      meetingKeys.asrJobs(wsId, meetingId),
    )).toEqual({
      jobs: [retriedJob],
      total: 1,
    });
  });
});

describe("useSaveMeetingAudioAsset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the saved audio asset into the audio assets query cache immediately", async () => {
    const qc = createQueryClient();
    const existingAsset = audioAsset({ id: "asset-2", filename: "existing.webm" });
    const savedAsset = audioAsset({ id: "asset-1", filename: "meeting.webm" });
    qc.setQueryData<ListMeetingAudioAssetsResponse>(meetingKeys.audioAssets(wsId, meetingId), {
      assets: [existingAsset],
      total: 1,
    });
    const saveMeetingAudioAsset = vi.fn().mockResolvedValue(savedAsset);
    setApiInstance({
      saveMeetingAudioAsset,
    } as unknown as ApiClient);

    const { result } = renderHook(() => useSaveMeetingAudioAsset(wsId), {
      wrapper: wrapperFor(qc),
    });

    const file = new File(["audio"], "meeting.webm", { type: "audio/webm" });
    result.current.mutate({
      meetingId,
      data: {
        file,
        duration_seconds: 4,
      },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(saveMeetingAudioAsset).toHaveBeenCalledWith(meetingId, {
      file,
      duration_seconds: 4,
    });
    expect(qc.getQueryData<ListMeetingAudioAssetsResponse>(
      meetingKeys.audioAssets(wsId, meetingId),
    )).toEqual({
      assets: [savedAsset, existingAsset],
      total: 2,
    });
  });
});

describe("useDeleteMeetingAudioAsset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes deleted audio assets from the audio asset query cache", async () => {
    const qc = createQueryClient();
    const deletedAsset = audioAsset({ id: "asset-1", filename: "delete.webm" });
    const remainingAsset = audioAsset({ id: "asset-2", filename: "keep.webm" });
    qc.setQueryData<ListMeetingAudioAssetsResponse>(meetingKeys.audioAssets(wsId, meetingId), {
      assets: [deletedAsset, remainingAsset],
      total: 2,
    });
    const deleteMeetingAudioAsset = vi.fn().mockResolvedValue(undefined);
    setApiInstance({
      deleteMeetingAudioAsset,
    } as unknown as ApiClient);

    const { result } = renderHook(() => useDeleteMeetingAudioAsset(wsId), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({ meetingId, assetId: "asset-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(deleteMeetingAudioAsset).toHaveBeenCalledWith(meetingId, "asset-1");
    expect(qc.getQueryData<ListMeetingAudioAssetsResponse>(
      meetingKeys.audioAssets(wsId, meetingId),
    )).toEqual({
      assets: [remainingAsset],
      total: 1,
    });
  });
});
