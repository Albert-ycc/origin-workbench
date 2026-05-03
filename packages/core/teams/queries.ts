import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const teamKeys = {
  all: (wsId: string) => ["teams", wsId] as const,
  list: (wsId: string, status: "active" | "archived" = "active") =>
    [...teamKeys.all(wsId), "list", status] as const,
  detail: (wsId: string, id: string) =>
    [...teamKeys.all(wsId), "detail", id] as const,
  messages: (wsId: string, id: string) =>
    [...teamKeys.all(wsId), "messages", id] as const,
};

export function teamListOptions(wsId: string, status: "active" | "archived" = "active") {
  return queryOptions({
    queryKey: teamKeys.list(wsId, status),
    queryFn: () => api.listTeams(status),
    select: (data) => data.teams,
  });
}

export function teamDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: teamKeys.detail(wsId, id),
    queryFn: () => api.getTeam(id),
  });
}

export function teamMessagesOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: teamKeys.messages(wsId, id),
    queryFn: () => api.listTeamMessages(id),
  });
}
