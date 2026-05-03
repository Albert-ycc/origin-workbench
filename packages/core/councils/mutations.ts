import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { councilKeys } from "./queries";
import type {
  AddCouncilParticipantRequest,
  AdjournCouncilSessionRequest,
  CouncilSession,
  CouncilSessionDetail,
  CouncilSessionParticipant,
  CreateCouncilSessionRequest,
  ListCouncilSessionsResponse,
  UpdateCouncilSessionRequest,
} from "../types";

export function useCreateCouncilSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateCouncilSessionRequest) => api.createCouncilSession(data),
    onSuccess: (detail) => {
      qc.setQueryData<ListCouncilSessionsResponse>(councilKeys.list(wsId), (old) =>
        old && !old.sessions.some((s) => s.id === detail.session.id)
          ? { ...old, sessions: [detail.session, ...old.sessions], total: old.total + 1 }
          : old,
      );
      qc.setQueryData<CouncilSessionDetail>(
        councilKeys.detail(wsId, detail.session.id),
        detail,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: councilKeys.list(wsId) });
    },
  });
}

export function useUpdateCouncilSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateCouncilSessionRequest) =>
      api.updateCouncilSession(id, data),
    onSuccess: (session) => patchSessionCaches(qc, wsId, session),
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: councilKeys.detail(wsId, vars.id) });
      qc.invalidateQueries({ queryKey: councilKeys.list(wsId) });
    },
  });
}

export function useAdjournCouncilSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & AdjournCouncilSessionRequest) =>
      api.adjournCouncilSession(id, data),
    onSuccess: (session) => patchSessionCaches(qc, wsId, session),
    onSettled: () => qc.invalidateQueries({ queryKey: councilKeys.all(wsId) }),
  });
}

export function useArchiveCouncilSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.archiveCouncilSession(id),
    onSuccess: (session) => {
      qc.setQueryData<ListCouncilSessionsResponse>(councilKeys.list(wsId), (old) =>
        old
          ? {
              ...old,
              sessions: old.sessions.filter((s) => s.id !== session.id),
              total: Math.max(0, old.total - 1),
            }
          : old,
      );
      qc.invalidateQueries({ queryKey: councilKeys.all(wsId) });
    },
  });
}

export function useDeleteCouncilSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.deleteCouncilSession(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<ListCouncilSessionsResponse>(councilKeys.list(wsId), (old) =>
        old
          ? {
              ...old,
              sessions: old.sessions.filter((s) => s.id !== id),
              total: Math.max(0, old.total - 1),
            }
          : old,
      );
      qc.removeQueries({ queryKey: councilKeys.detail(wsId, id) });
    },
  });
}

export function useAddCouncilParticipant() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ sessionId, ...data }: { sessionId: string } & AddCouncilParticipantRequest) =>
      api.addCouncilParticipant(sessionId, data),
    onSuccess: (participant: CouncilSessionParticipant, vars) => {
      qc.setQueryData<CouncilSessionDetail>(councilKeys.detail(wsId, vars.sessionId), (old) =>
        old
          ? {
              ...old,
              participants: [
                ...old.participants.filter((p) => p.agent_id !== participant.agent_id),
                participant,
              ],
            }
          : old,
      );
      qc.invalidateQueries({ queryKey: councilKeys.detail(wsId, vars.sessionId) });
    },
  });
}

export function useRemoveCouncilParticipant() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ sessionId, agentId }: { sessionId: string; agentId: string }) =>
      api.removeCouncilParticipant(sessionId, agentId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: councilKeys.detail(wsId, vars.sessionId) });
    },
  });
}

function patchSessionCaches(
  qc: ReturnType<typeof useQueryClient>,
  wsId: string,
  session: CouncilSession,
) {
  qc.setQueryData<ListCouncilSessionsResponse>(councilKeys.list(wsId), (old) =>
    old
      ? { ...old, sessions: old.sessions.map((s) => (s.id === session.id ? session : s)) }
      : old,
  );
  qc.setQueryData<CouncilSessionDetail>(councilKeys.detail(wsId, session.id), (old) =>
    old ? { ...old, session } : old,
  );
}
