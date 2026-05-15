import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const missionKeys = {
  all: (wsId: string) => ["missions", wsId] as const,
  list: (wsId: string, status: "active" | "archived" = "active", projectId?: string | null) =>
    [...missionKeys.all(wsId), "list", status, projectId ?? "all"] as const,
  detail: (wsId: string, id: string) =>
    [...missionKeys.all(wsId), "detail", id] as const,
};

export function missionListOptions(
  wsId: string,
  status: "active" | "archived" = "active",
  projectId?: string | null,
) {
  return queryOptions({
    queryKey: missionKeys.list(wsId, status, projectId),
    queryFn: () => api.listMissions(projectId ? { status, project_id: projectId } : status),
    select: (data) => data.missions,
    enabled: projectId !== "",
  });
}

export function missionDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: missionKeys.detail(wsId, id),
    queryFn: () => api.getMission(id),
    enabled: !!id,
  });
}
