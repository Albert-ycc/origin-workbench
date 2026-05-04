import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const explorationKeys = {
  all: (wsId: string) => ["explorations", wsId] as const,
  list: (wsId: string, status: "active" | "archived" = "active") =>
    [...explorationKeys.all(wsId), "list", status] as const,
  detail: (wsId: string, id: string) =>
    [...explorationKeys.all(wsId), "detail", id] as const,
};

export function explorationListOptions(
  wsId: string,
  status: "active" | "archived" = "active",
) {
  return queryOptions({
    queryKey: explorationKeys.list(wsId, status),
    queryFn: () => api.listExplorations(status),
    select: (data) => data.explorations,
  });
}

export function explorationDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: explorationKeys.detail(wsId, id),
    queryFn: () => api.getExploration(id),
    enabled: !!id,
  });
}
