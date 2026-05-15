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
