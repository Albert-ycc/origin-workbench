import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { ToolBindingFilter } from "../types";

export const toolBindingKeys = {
  all: (wsId: string) => ["tool-bindings", wsId] as const,
  list: (wsId: string, filter: ToolBindingFilter = {}) =>
    [...toolBindingKeys.all(wsId), "list", canonicalKey(filter)] as const,
};

function canonicalKey(filter: ToolBindingFilter): string {
  const parts: string[] = [];
  if (filter.mission_id) parts.push(`m:${filter.mission_id}`);
  if (filter.agent_id) parts.push(`a:${filter.agent_id}`);
  if (filter.idea_id) parts.push(`i:${filter.idea_id}`);
  if (filter.council_session_id) parts.push(`c:${filter.council_session_id}`);
  if (filter.project_id) parts.push(`p:${filter.project_id}`);
  return parts.length === 0 ? "all" : parts.join("|");
}

export function toolBindingListOptions(wsId: string, filter: ToolBindingFilter = {}) {
  return queryOptions({
    queryKey: toolBindingKeys.list(wsId, filter),
    queryFn: () => api.listToolBindings(filter),
    select: (data) => data.bindings,
    enabled: !!wsId,
  });
}
