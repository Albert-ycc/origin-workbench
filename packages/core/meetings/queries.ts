import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

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
    queryFn: () => api.listMeetingTranscriptSegments(meetingId),
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
