import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CreateMeetingSessionRequest,
  CreateMeetingTranscriptSegmentRequest,
  MeetingInsightStatus,
  UpdateMeetingSessionRequest,
} from "../types";
import { meetingKeys } from "./queries";

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
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, meeting.project_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, null) });
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
      qc.invalidateQueries({ queryKey: meetingKeys.transcript(wsId, segment.meeting_id) });
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
