import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const ideaKeys = {
  all: (wsId: string) => ["ideas", wsId] as const,
  list: (wsId: string, status: "active" | "archived" = "active") =>
    [...ideaKeys.all(wsId), "list", status] as const,
  detail: (wsId: string, id: string) =>
    [...ideaKeys.all(wsId), "detail", id] as const,
};

export function ideaListOptions(wsId: string, status: "active" | "archived" = "active") {
  return queryOptions({
    queryKey: ideaKeys.list(wsId, status),
    queryFn: () => api.listIdeas(status),
    select: (data) => data.ideas,
  });
}

export function ideaDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: ideaKeys.detail(wsId, id),
    queryFn: () => api.getIdea(id),
    enabled: !!id,
  });
}
