import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const agentTaskSnapshotKeys = {
  all: (wsId: string) => ["workspaces", wsId, "agent-task-snapshot"] as const,
  list: (wsId: string) => [...agentTaskSnapshotKeys.all(wsId), "list"] as const,
};

export const agentActivityKeys = {
  all: (wsId: string) => ["workspaces", wsId, "agent-activity"] as const,
  last365d: (wsId: string) => [...agentActivityKeys.all(wsId), "365d"] as const,
};

export const agentRunCountsKeys = {
  all: (wsId: string) => ["workspaces", wsId, "agent-run-counts"] as const,
  last30d: (wsId: string) => [...agentRunCountsKeys.all(wsId), "30d"] as const,
};

// Workspace-scoped agent task snapshot — every active task plus each agent's
// most recent terminal task. This is the single shared source of truth that
// powers per-agent presence derivation across the app. One fetch per
// workspace; all agent dots / hover cards / list rows derive presence from
// this cache with zero additional network traffic.
//
// The 30s staleTime is a safety net only; the primary freshness signal is
// WS task events, which invalidate this query immediately. Without WS,
// presence still updates within 30s on focus / mount.
export function agentTaskSnapshotOptions(wsId: string) {
  return queryOptions({
    queryKey: agentTaskSnapshotKeys.list(wsId),
    queryFn: () => api.getAgentTaskSnapshot(),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

// Workspace-wide daily task activity for the last 365 days, anchored on
// completed_at. One fetch backs both the Agents-list sparkline (which
// only uses the trailing 7 buckets via `summarizeActivityWindow`) and
// the agent detail year heatmap. WS task lifecycle events
// invalidate this query in useRealtimeSync; the staleTime is a
// tab-focus safety net.
export function agentActivity365dOptions(wsId: string) {
  return queryOptions({
    queryKey: agentActivityKeys.last365d(wsId),
    queryFn: () => api.getWorkspaceAgentActivity365d(),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

// Workspace-wide 30-day run counts for the Agents-list RUNS column. Same
// single-fetch / WS-invalidate pattern as activity24hOptions.
export function agentRunCounts30dOptions(wsId: string) {
  return queryOptions({
    queryKey: agentRunCountsKeys.last30d(wsId),
    queryFn: () => api.getWorkspaceAgentRunCounts(),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export const agentTasksKeys = {
  all: (wsId: string) => ["workspaces", wsId, "agent-tasks"] as const,
  detail: (wsId: string, agentId: string) =>
    [...agentTasksKeys.all(wsId), agentId] as const,
};

export const agentMemoryKeys = {
  all: (wsId: string) => ["workspaces", wsId, "agent-memories"] as const,
  detail: (wsId: string, agentId: string) =>
    [...agentMemoryKeys.all(wsId), agentId] as const,
};

export const agentSkillCandidateKeys = {
  all: (wsId: string) => ["workspaces", wsId, "agent-skill-candidates"] as const,
  detail: (wsId: string, agentId: string) =>
    [...agentSkillCandidateKeys.all(wsId), agentId] as const,
};

export const agentEventKeys = {
  all: (wsId: string) => ["workspaces", wsId, "agent-events"] as const,
  detail: (wsId: string, agentId: string) =>
    [...agentEventKeys.all(wsId), agentId] as const,
};

// All tasks for a single agent (the agent detail page consumer). Powers both
// the inspector's 7-day throughput stats and the Tasks tab list — shared so
// they don't fetch twice. WS task events invalidate this via the existing
// task-prefix invalidation in useRealtimeSync.
export function agentTasksOptions(wsId: string, agentId: string) {
  return queryOptions({
    queryKey: agentTasksKeys.detail(wsId, agentId),
    queryFn: () => api.listAgentTasks(agentId),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function agentMemoriesOptions(wsId: string, agentId: string) {
  return queryOptions({
    queryKey: agentMemoryKeys.detail(wsId, agentId),
    queryFn: () => api.listAgentMemories(agentId),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function agentSkillCandidatesOptions(wsId: string, agentId: string) {
  return queryOptions({
    queryKey: agentSkillCandidateKeys.detail(wsId, agentId),
    queryFn: () => api.listAgentSkillCandidates(agentId),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function agentEventsOptions(wsId: string, agentId: string) {
  return queryOptions({
    queryKey: agentEventKeys.detail(wsId, agentId),
    queryFn: () => api.listAgentEvents(agentId),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
