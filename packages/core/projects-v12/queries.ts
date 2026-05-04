import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const projectV12Keys = {
  all: (wsId: string) => ["projects-v12", wsId] as const,
  list: (wsId: string) => [...projectV12Keys.all(wsId), "list"] as const,
  detail: (wsId: string, id: string) =>
    [...projectV12Keys.all(wsId), "detail", id] as const,
  byTeam: (wsId: string, teamId: string) =>
    [...projectV12Keys.all(wsId), "by-team", teamId] as const,
  memories: (wsId: string, projectId: string) =>
    [...projectV12Keys.all(wsId), "memories", projectId] as const,
};

export function projectV12ListOptions(wsId: string) {
  return queryOptions({
    queryKey: projectV12Keys.list(wsId),
    queryFn: () => api.listProjectsV12(),
    select: (data) => data.projects,
  });
}

export function projectV12DetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: projectV12Keys.detail(wsId, id),
    queryFn: () => api.getProjectV12(id),
    enabled: !!id,
  });
}

export function projectsByTeamV12Options(wsId: string, teamId: string) {
  return queryOptions({
    queryKey: projectV12Keys.byTeam(wsId, teamId),
    queryFn: () => api.listProjectsByTeamV12(teamId),
    select: (data) => data.projects,
    enabled: !!teamId,
  });
}
