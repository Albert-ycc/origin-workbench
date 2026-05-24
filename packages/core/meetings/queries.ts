import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { ListMeetingASRJobsResponse, ListMeetingTranscriptSegmentsResponse } from "../types";

const TRANSCRIPT_PAGE_LIMIT = 1000;

export const meetingKeys = {
  all: (wsId: string) => ["meetings", wsId] as const,
  list: (wsId: string, projectId?: string | null) =>
    [...meetingKeys.all(wsId), "list", projectId ?? "all"] as const,
  detail: (wsId: string, meetingId: string) =>
    [...meetingKeys.all(wsId), "detail", meetingId] as const,
  transcript: (wsId: string, meetingId: string) =>
    [...meetingKeys.all(wsId), "transcript", meetingId] as const,
  insights: (wsId: string, meetingId: string) =>
    [...meetingKeys.all(wsId), "insights", meetingId] as const,
  summary: (wsId: string, meetingId: string) =>
    [...meetingKeys.all(wsId), "summary", meetingId] as const,
  asrStatus: (wsId: string) =>
    [...meetingKeys.all(wsId), "asr-status"] as const,
  audioAssets: (wsId: string, meetingId: string) =>
    [...meetingKeys.all(wsId), "audio-assets", meetingId] as const,
  asrJobs: (wsId: string, meetingId: string) =>
    [...meetingKeys.all(wsId), "asr-jobs", meetingId] as const,
};

export function meetingListOptions(wsId: string, projectId?: string | null) {
  return queryOptions({
    queryKey: meetingKeys.list(wsId, projectId),
    queryFn: () => api.listMeetings(projectId ? { project_id: projectId } : undefined),
  });
}

export function meetingDetailOptions(wsId: string, meetingId: string) {
  return queryOptions({
    queryKey: meetingKeys.detail(wsId, meetingId),
    queryFn: () => api.getMeeting(meetingId),
    enabled: !!meetingId,
  });
}

export function meetingTranscriptOptions(wsId: string, meetingId: string) {
  return queryOptions({
    queryKey: meetingKeys.transcript(wsId, meetingId),
    queryFn: async (): Promise<ListMeetingTranscriptSegmentsResponse> => {
      const segments: ListMeetingTranscriptSegmentsResponse["segments"] = [];
      let afterSeq = 0;

      while (true) {
        const page = await api.listMeetingTranscriptSegments(meetingId, {
          after_seq: afterSeq,
          limit: TRANSCRIPT_PAGE_LIMIT,
        });
        segments.push(...page.segments);
        if (page.segments.length < TRANSCRIPT_PAGE_LIMIT) break;
        afterSeq = page.segments[page.segments.length - 1]?.seq ?? afterSeq;
      }

      return { segments, total: segments.length };
    },
    enabled: !!meetingId,
  });
}

export function meetingInsightOptions(wsId: string, meetingId: string) {
  return queryOptions({
    queryKey: meetingKeys.insights(wsId, meetingId),
    queryFn: () => api.listMeetingInsightCards(meetingId),
    enabled: !!meetingId,
  });
}

export function meetingSummaryOptions(wsId: string, meetingId: string) {
  return queryOptions({
    queryKey: meetingKeys.summary(wsId, meetingId),
    queryFn: () => api.getMeetingSummary(meetingId),
    enabled: !!meetingId,
    retry: false,
  });
}

export function meetingASRStatusOptions(wsId: string) {
  return queryOptions({
    queryKey: meetingKeys.asrStatus(wsId),
    queryFn: () => api.getMeetingASRStatus(),
    enabled: !!wsId,
  });
}

export function meetingAudioAssetOptions(wsId: string, meetingId: string) {
  return queryOptions({
    queryKey: meetingKeys.audioAssets(wsId, meetingId),
    queryFn: () => api.listMeetingAudioAssets(meetingId),
    enabled: !!meetingId,
  });
}

export function meetingASRJobOptions(wsId: string, meetingId: string) {
  return queryOptions({
    queryKey: meetingKeys.asrJobs(wsId, meetingId),
    queryFn: () => api.listMeetingASRJobs(meetingId),
    enabled: !!meetingId,
    refetchInterval: (query) => {
      const data = query.state.data as ListMeetingASRJobsResponse | undefined;
      return data?.jobs.some((job) => job.status === "running" || job.status === "queued")
        ? 2000
        : false;
    },
  });
}
