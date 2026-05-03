import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const missionKeys = {
  all: (wsId: string) => ["missions", wsId] as const,
  list: (wsId: string, status: "active" | "archived" = "active") =>
    [...missionKeys.all(wsId), "list", status] as const,
  detail: (wsId: string, id: string) =>
    [...missionKeys.all(wsId), "detail", id] as const,
};

export function missionListOptions(wsId: string, status: "active" | "archived" = "active") {
  return queryOptions({
    queryKey: missionKeys.list(wsId, status),
    queryFn: () => api.listMissions(status),
    select: (data) => data.missions,
  });
}

export function missionDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: missionKeys.detail(wsId, id),
    queryFn: () => api.getMission(id),
    enabled: !!id,
  });
}
