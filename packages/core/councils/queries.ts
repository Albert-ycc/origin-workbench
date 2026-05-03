import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const councilKeys = {
  all: (wsId: string) => ["councils", wsId] as const,
  list: (wsId: string, status: "active" | "archived" = "active") =>
    [...councilKeys.all(wsId), "list", status] as const,
  detail: (wsId: string, id: string) =>
    [...councilKeys.all(wsId), "detail", id] as const,
};

export function councilListOptions(wsId: string, status: "active" | "archived" = "active") {
  return queryOptions({
    queryKey: councilKeys.list(wsId, status),
    queryFn: () => api.listCouncilSessions(status),
    select: (data) => data.sessions,
  });
}

export function councilDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: councilKeys.detail(wsId, id),
    queryFn: () => api.getCouncilSession(id),
    enabled: !!id,
  });
}
