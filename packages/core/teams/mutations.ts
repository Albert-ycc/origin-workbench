import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { teamKeys } from "./queries";
import { useWorkspaceId } from "../hooks";
import type {
  CreateTeamRequest,
  UpdateTeamRequest,
  AddTeamMemberRequest,
  ListTeamsResponse,
  ListTeamMessagesResponse,
  PostTeamMessageRequest,
  Team,
  TeamMessage,
} from "../types";

export function useCreateTeam() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateTeamRequest) => api.createTeam(data),
    onSuccess: (newTeam) => {
      qc.setQueryData<ListTeamsResponse>(teamKeys.list(wsId), (old) =>
        old && !old.teams.some((t) => t.id === newTeam.id)
          ? { ...old, teams: [newTeam, ...old.teams], total: old.total + 1 }
          : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) });
    },
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateTeamRequest) =>
      api.updateTeam(id, data),
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: teamKeys.detail(wsId, vars.id) });
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.deleteTeam(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: teamKeys.list(wsId) });
      const prevList = qc.getQueryData<ListTeamsResponse>(teamKeys.list(wsId));
      qc.setQueryData<ListTeamsResponse>(teamKeys.list(wsId), (old) =>
        old
          ? {
              ...old,
              teams: old.teams.filter((t) => t.id !== id),
              total: Math.max(0, old.total - 1),
            }
          : old,
      );
      qc.removeQueries({ queryKey: teamKeys.detail(wsId, id) });
      qc.removeQueries({ queryKey: teamKeys.messages(wsId, id) });
      return { prevList };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevList) qc.setQueryData(teamKeys.list(wsId), ctx.prevList);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) });
    },
  });
}

export function useArchiveTeam() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.archiveTeam(id),
    onSuccess: (team) => {
      qc.invalidateQueries({ queryKey: teamKeys.all(wsId) });
      qc.setQueryData(teamKeys.detail(wsId, team.id), team);
    },
  });
}

export function useRestoreTeam() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.restoreTeam(id),
    onSuccess: (team) => {
      qc.invalidateQueries({ queryKey: teamKeys.all(wsId) });
      qc.setQueryData(teamKeys.detail(wsId, team.id), team);
    },
  });
}

export function useAddTeamMember() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ teamId, ...data }: { teamId: string } & AddTeamMemberRequest) =>
      api.addTeamMember(teamId, data),
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: teamKeys.detail(wsId, vars.teamId) });
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) });
    },
  });
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ teamId, agentId }: { teamId: string; agentId: string }) =>
      api.removeTeamMember(teamId, agentId),
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: teamKeys.detail(wsId, vars.teamId) });
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) });
    },
  });
}

export function usePostTeamMessage() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({
      teamId,
      ...data
    }: { teamId: string } & PostTeamMessageRequest) =>
      api.postTeamMessage(teamId, data),
    // Optimistic insert: append the user's message into the cache before
    // the round-trip lands. Captain agent reply arrives via WS / refetch.
    onMutate: async ({ teamId, content }) => {
      await qc.cancelQueries({ queryKey: teamKeys.messages(wsId, teamId) });
      const prev = qc.getQueryData<ListTeamMessagesResponse>(
        teamKeys.messages(wsId, teamId),
      );
      const optimistic: TeamMessage = {
        id: `optimistic-${Date.now()}`,
        chat_session_id: "",
        team_id: teamId,
        role: "user",
        content,
        sender_agent_id: null,
        created_at: new Date().toISOString(),
      };
      qc.setQueryData<ListTeamMessagesResponse>(
        teamKeys.messages(wsId, teamId),
        (old) =>
          old
            ? { ...old, messages: [...old.messages, optimistic] }
            : { messages: [optimistic] },
      );
      return { prev, optimisticId: optimistic.id };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(teamKeys.messages(wsId, vars.teamId), ctx.prev);
      }
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: teamKeys.messages(wsId, vars.teamId) });
    },
  });
}

// Re-export Team for convenience in views.
export type { Team };
