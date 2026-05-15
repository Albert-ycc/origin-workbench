import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const ideaKeys = {
  all: (wsId: string) => ["ideas", wsId] as const,
  list: (wsId: string, status: "active" | "archived" = "active", projectId?: string | null) =>
    [...ideaKeys.all(wsId), "list", status, projectId ?? "all"] as const,
  detail: (wsId: string, id: string) =>
    [...ideaKeys.all(wsId), "detail", id] as const,
};

export function ideaListOptions(
  wsId: string,
  status: "active" | "archived" = "active",
  projectId?: string | null,
) {
  return queryOptions({
    queryKey: ideaKeys.list(wsId, status, projectId),
    queryFn: () => api.listIdeas(projectId ? { status, project_id: projectId } : status),
    select: (data) => data.ideas,
    enabled: projectId !== "",
  });
}

export function ideaDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: ideaKeys.detail(wsId, id),
    queryFn: () => api.getIdea(id),
    enabled: !!id,
  });
}
