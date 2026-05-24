import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CreateMeetingASRJobRequest,
  CreateMeetingSessionRequest,
  CreateMeetingTranscriptSegmentRequest,
  ListMeetingAudioAssetsResponse,
  ListMeetingASRJobsResponse,
  ListMeetingTranscriptSegmentsResponse,
  MeetingASRJob,
  MeetingInsightStatus,
  MeetingTranscriptSegment,
  MergeMeetingTranscriptSegmentsRequest,
  SaveMeetingAudioAssetRequest,
  SplitMeetingTranscriptSegmentRequest,
  UpdateMeetingTranscriptSegmentRequest,
  UpdateMeetingSessionRequest,
} from "../types";
import { meetingKeys } from "./queries";

function upsertASRJob(old: ListMeetingASRJobsResponse | undefined, job: MeetingASRJob) {
  const existingJobs = old?.jobs ?? [];
  const jobs = [job, ...existingJobs.filter((existing) => existing.id !== job.id)];
  return { jobs, total: jobs.length };
}

function sortTranscriptSegments(segments: MeetingTranscriptSegment[]) {
  return [...segments].sort((a, b) => a.seq - b.seq);
}

function upsertTranscriptSegments(
  old: ListMeetingTranscriptSegmentsResponse | undefined,
  incoming: MeetingTranscriptSegment[],
  removeIds: string[] = [],
) {
  const removeIdSet = new Set(removeIds);
  const incomingIds = new Set(incoming.map((segment) => segment.id));
  const segments = sortTranscriptSegments([
    ...(old?.segments ?? []).filter(
      (segment) => !removeIdSet.has(segment.id) && !incomingIds.has(segment.id),
    ),
    ...incoming,
  ]);
  return { segments, total: segments.length };
}

function invalidateCompletedASROutputs(
  qc: ReturnType<typeof useQueryClient>,
  wsId: string,
  job: MeetingASRJob,
) {
  if (job.status !== "completed") return;
  qc.invalidateQueries({ queryKey: meetingKeys.transcript(wsId, job.meeting_id) });
  qc.invalidateQueries({ queryKey: meetingKeys.insights(wsId, job.meeting_id) });
  qc.invalidateQueries({ queryKey: meetingKeys.summary(wsId, job.meeting_id) });
}

export function useCreateMeetingSession(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMeetingSessionRequest) => api.createMeeting(data),
    onSuccess: (meeting) => {
      qc.invalidateQueries({ queryKey: meetingKeys.all(wsId) });
      qc.setQueryData(meetingKeys.detail(wsId, meeting.id), meeting);
    },
  });
}

export function useUpdateMeetingSession(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMeetingSessionRequest }) =>
      api.updateMeeting(id, data),
    onSuccess: (meeting) => {
      qc.setQueryData(meetingKeys.detail(wsId, meeting.id), meeting);
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, meeting.project_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, null) });
    },
  });
}

export function useStartMeetingSession(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.startMeeting(id),
    onSuccess: (meeting) => {
      qc.setQueryData(meetingKeys.detail(wsId, meeting.id), meeting);
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, meeting.project_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, null) });
    },
  });
}

export function useStopMeetingSession(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.stopMeeting(id),
    onSuccess: (meeting) => {
      qc.setQueryData(meetingKeys.detail(wsId, meeting.id), meeting);
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, meeting.project_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, null) });
    },
  });
}

export function useArchiveMeetingSession(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveMeeting(id),
    onSuccess: (meeting) => {
      qc.removeQueries({ queryKey: meetingKeys.detail(wsId, meeting.id) });
      qc.removeQueries({ queryKey: meetingKeys.transcript(wsId, meeting.id) });
      qc.removeQueries({ queryKey: meetingKeys.insights(wsId, meeting.id) });
      qc.removeQueries({ queryKey: meetingKeys.summary(wsId, meeting.id) });
      qc.removeQueries({ queryKey: meetingKeys.audioAssets(wsId, meeting.id) });
      qc.removeQueries({ queryKey: meetingKeys.asrJobs(wsId, meeting.id) });
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, meeting.project_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, null) });
    },
  });
}

export function useDeleteMeetingSession(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMeeting(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: meetingKeys.detail(wsId, id) });
      qc.removeQueries({ queryKey: meetingKeys.transcript(wsId, id) });
      qc.removeQueries({ queryKey: meetingKeys.insights(wsId, id) });
      qc.removeQueries({ queryKey: meetingKeys.summary(wsId, id) });
      qc.removeQueries({ queryKey: meetingKeys.audioAssets(wsId, id) });
      qc.removeQueries({ queryKey: meetingKeys.asrJobs(wsId, id) });
      qc.invalidateQueries({ queryKey: meetingKeys.all(wsId) });
    },
  });
}

export function useGenerateMeetingSummary(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.generateMeetingSummary(id),
    onSuccess: (summary) => {
      qc.setQueryData(meetingKeys.summary(wsId, summary.meeting_id), summary);
      qc.invalidateQueries({ queryKey: meetingKeys.detail(wsId, summary.meeting_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, summary.project_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, null) });
    },
  });
}

export function useCreateMeetingTranscriptSegment(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      meetingId,
      data,
    }: {
      meetingId: string;
      data: CreateMeetingTranscriptSegmentRequest;
    }) => api.createMeetingTranscriptSegment(meetingId, data),
    onSuccess: (segment) => {
      qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
        meetingKeys.transcript(wsId, segment.meeting_id),
        (old) => {
          const existingSegments = old?.segments ?? [];
          const segments = [
            ...existingSegments.filter(
              (existing) => existing.id !== segment.id && existing.seq !== segment.seq,
            ),
            segment,
          ].sort((a, b) => a.seq - b.seq);
          return { segments, total: segments.length };
        },
      );
      qc.invalidateQueries({ queryKey: meetingKeys.transcript(wsId, segment.meeting_id) });
    },
  });
}

export function useUpdateMeetingTranscriptSegment(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      meetingId,
      segmentId,
      data,
    }: {
      meetingId: string;
      segmentId: string;
      data: UpdateMeetingTranscriptSegmentRequest;
    }) => api.updateMeetingTranscriptSegment(meetingId, segmentId, data),
    onSuccess: (segment) => {
      qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
        meetingKeys.transcript(wsId, segment.meeting_id),
        (old) => upsertTranscriptSegments(old, [segment]),
      );
      qc.invalidateQueries({ queryKey: meetingKeys.summary(wsId, segment.meeting_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.insights(wsId, segment.meeting_id) });
    },
  });
}

export function useDeleteMeetingTranscriptSegment(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ meetingId, segmentId }: { meetingId: string; segmentId: string }) =>
      api.deleteMeetingTranscriptSegment(meetingId, segmentId),
    onSuccess: (_data, { meetingId, segmentId }) => {
      qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
        meetingKeys.transcript(wsId, meetingId),
        (old) => {
          const segments = (old?.segments ?? []).filter((segment) => segment.id !== segmentId);
          return { segments, total: segments.length };
        },
      );
      qc.invalidateQueries({ queryKey: meetingKeys.summary(wsId, meetingId) });
      qc.invalidateQueries({ queryKey: meetingKeys.insights(wsId, meetingId) });
    },
  });
}

export function useSplitMeetingTranscriptSegment(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      meetingId,
      segmentId,
      data,
    }: {
      meetingId: string;
      segmentId: string;
      data: SplitMeetingTranscriptSegmentRequest;
    }) => api.splitMeetingTranscriptSegment(meetingId, segmentId, data),
    onSuccess: (response, { meetingId, segmentId }) => {
      qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
        meetingKeys.transcript(wsId, meetingId),
        (old) => upsertTranscriptSegments(old, response.segments, [segmentId]),
      );
      qc.invalidateQueries({ queryKey: meetingKeys.summary(wsId, meetingId) });
      qc.invalidateQueries({ queryKey: meetingKeys.insights(wsId, meetingId) });
    },
  });
}

export function useMergeMeetingTranscriptSegments(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      meetingId,
      segmentId,
      data,
    }: {
      meetingId: string;
      segmentId: string;
      data: MergeMeetingTranscriptSegmentsRequest;
    }) => api.mergeMeetingTranscriptSegments(meetingId, segmentId, data),
    onSuccess: (response, { meetingId }) => {
      qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
        meetingKeys.transcript(wsId, meetingId),
        (old) =>
          upsertTranscriptSegments(old, [response.segment], [response.deleted_segment_id]),
      );
      qc.invalidateQueries({ queryKey: meetingKeys.summary(wsId, meetingId) });
      qc.invalidateQueries({ queryKey: meetingKeys.insights(wsId, meetingId) });
    },
  });
}

export function useSaveMeetingAudioAsset(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      meetingId,
      data,
    }: {
      meetingId: string;
      data: SaveMeetingAudioAssetRequest;
    }) => api.saveMeetingAudioAsset(meetingId, data),
    onSuccess: (asset) => {
      qc.setQueryData<ListMeetingAudioAssetsResponse>(
        meetingKeys.audioAssets(wsId, asset.meeting_id),
        (old) => {
          const existingAssets = old?.assets ?? [];
          const assets = [
            asset,
            ...existingAssets.filter((existing) => existing.id !== asset.id),
          ];
          return { assets, total: assets.length };
        },
      );
      qc.invalidateQueries({ queryKey: meetingKeys.audioAssets(wsId, asset.meeting_id) });
    },
  });
}

export function useDeleteMeetingAudioAsset(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ meetingId, assetId }: { meetingId: string; assetId: string }) =>
      api.deleteMeetingAudioAsset(meetingId, assetId),
    onSuccess: (_data, { meetingId, assetId }) => {
      qc.setQueryData<ListMeetingAudioAssetsResponse>(
        meetingKeys.audioAssets(wsId, meetingId),
        (old) => {
          const assets = (old?.assets ?? []).filter((asset) => asset.id !== assetId);
          return { assets, total: assets.length };
        },
      );
      qc.invalidateQueries({ queryKey: meetingKeys.audioAssets(wsId, meetingId) });
      qc.invalidateQueries({ queryKey: meetingKeys.asrJobs(wsId, meetingId) });
    },
  });
}

export function useCreateMeetingASRJob(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      meetingId,
      audioAssetId,
      data,
    }: {
      meetingId: string;
      audioAssetId: string;
      data?: CreateMeetingASRJobRequest;
    }) => api.createMeetingASRJob(meetingId, audioAssetId, data ?? {}),
    onSuccess: (job) => {
      qc.setQueryData<ListMeetingASRJobsResponse>(
        meetingKeys.asrJobs(wsId, job.meeting_id),
        (old) => upsertASRJob(old, job),
      );
      qc.invalidateQueries({ queryKey: meetingKeys.asrJobs(wsId, job.meeting_id) });
      invalidateCompletedASROutputs(qc, wsId, job);
    },
  });
}

export function useRetryMeetingASRJob(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ meetingId, jobId }: { meetingId: string; jobId: string }) =>
      api.retryMeetingASRJob(meetingId, jobId),
    onSuccess: (job) => {
      qc.setQueryData<ListMeetingASRJobsResponse>(
        meetingKeys.asrJobs(wsId, job.meeting_id),
        (old) => upsertASRJob(old, job),
      );
      qc.invalidateQueries({ queryKey: meetingKeys.asrJobs(wsId, job.meeting_id) });
      invalidateCompletedASROutputs(qc, wsId, job);
    },
  });
}

export function useUpdateMeetingInsightStatus(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      meetingId,
      insightId,
      status,
    }: {
      meetingId: string;
      insightId: string;
      status: MeetingInsightStatus;
    }) => api.updateMeetingInsightStatus(meetingId, insightId, status),
    onSuccess: (card) => {
      qc.invalidateQueries({ queryKey: meetingKeys.insights(wsId, card.meeting_id) });
    },
  });
}
