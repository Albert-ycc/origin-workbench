import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { ideaKeys } from "./queries";
import { missionKeys } from "../missions/queries";
import type {
  CreateIdeaRequest,
  CreateIdeaNoteRequest,
  Idea,
  IdeaDetail,
  IdeaNurtureNote,
  ListIdeasResponse,
  ListMissionsResponse,
  MissionDetail,
  PromoteIdeaRequest,
  UpdateIdeaRequest,
} from "../types";

export function useCreateIdea() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateIdeaRequest) => api.createIdea(data),
    onSuccess: (detail) => {
      const projectId = detail.idea.project_id;
      qc.setQueryData<ListIdeasResponse>(ideaKeys.list(wsId), (old) =>
        old && !old.ideas.some((i) => i.id === detail.idea.id)
          ? { ...old, ideas: [detail.idea, ...old.ideas], total: old.total + 1 }
          : old,
      );
      if (projectId) {
        qc.setQueryData<ListIdeasResponse>(ideaKeys.list(wsId, "active", projectId), (old) =>
          old && !old.ideas.some((i) => i.id === detail.idea.id)
            ? { ...old, ideas: [detail.idea, ...old.ideas], total: old.total + 1 }
            : old,
        );
      }
      qc.setQueryData<IdeaDetail>(ideaKeys.detail(wsId, detail.idea.id), detail);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ideaKeys.all(wsId) });
    },
  });
}

export function useUpdateIdea() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateIdeaRequest) =>
      api.updateIdea(id, data),
    onSuccess: (idea) => {
      patchIdeaCaches(qc, wsId, idea);
    },
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({ queryKey: ideaKeys.detail(wsId, vars.id) });
      qc.invalidateQueries({ queryKey: ideaKeys.all(wsId) });
    },
  });
}

export function useArchiveIdea() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.archiveIdea(id),
    onSuccess: (idea) => {
      qc.setQueryData<ListIdeasResponse>(ideaKeys.list(wsId), (old) =>
        old
          ? {
              ...old,
              ideas: old.ideas.filter((i) => i.id !== idea.id),
              total: Math.max(0, old.total - 1),
            }
          : old,
      );
      if (idea.project_id) {
        qc.setQueryData<ListIdeasResponse>(ideaKeys.list(wsId, "active", idea.project_id), (old) =>
          old
            ? {
                ...old,
                ideas: old.ideas.filter((i) => i.id !== idea.id),
                total: Math.max(0, old.total - 1),
              }
            : old,
        );
      }
      qc.invalidateQueries({ queryKey: ideaKeys.all(wsId) });
    },
  });
}

export function useDeleteIdea() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.deleteIdea(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<ListIdeasResponse>(ideaKeys.list(wsId), (old) =>
        old
          ? {
              ...old,
              ideas: old.ideas.filter((i) => i.id !== id),
              total: Math.max(0, old.total - 1),
            }
          : old,
      );
      qc.invalidateQueries({ queryKey: ideaKeys.all(wsId) });
      qc.removeQueries({ queryKey: ideaKeys.detail(wsId, id) });
    },
  });
}

export function useCreateIdeaNote() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ ideaId, ...data }: { ideaId: string } & CreateIdeaNoteRequest) =>
      api.createIdeaNote(ideaId, data),
    onSuccess: (note: IdeaNurtureNote, vars) => {
      qc.setQueryData<IdeaDetail>(ideaKeys.detail(wsId, vars.ideaId), (old) =>
        old ? { ...old, notes: [note, ...old.notes] } : old,
      );
      qc.invalidateQueries({ queryKey: ideaKeys.detail(wsId, vars.ideaId) });
      qc.invalidateQueries({ queryKey: ideaKeys.all(wsId) });
    },
  });
}

export function useDeleteIdeaNote() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ ideaId, noteId }: { ideaId: string; noteId: string }) =>
      api.deleteIdeaNote(ideaId, noteId),
    onSuccess: (_data, vars) => {
      qc.setQueryData<IdeaDetail>(ideaKeys.detail(wsId, vars.ideaId), (old) =>
        old
          ? { ...old, notes: old.notes.filter((n) => n.id !== vars.noteId) }
          : old,
      );
    },
  });
}

export function usePromoteIdea() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & PromoteIdeaRequest) =>
      api.promoteIdea(id, data),
    onSuccess: ({ idea, mission }) => {
      patchIdeaCaches(qc, wsId, idea);
      qc.setQueryData<ListIdeasResponse>(ideaKeys.list(wsId), (old) =>
        old
          ? {
              ...old,
              ideas: old.ideas.filter((i) => i.id !== idea.id),
              total: Math.max(0, old.total - 1),
            }
          : old,
      );
      if (idea.project_id) {
        qc.setQueryData<ListIdeasResponse>(ideaKeys.list(wsId, "active", idea.project_id), (old) =>
          old
            ? {
                ...old,
                ideas: old.ideas.filter((i) => i.id !== idea.id),
                total: Math.max(0, old.total - 1),
              }
            : old,
        );
      }
      qc.setQueryData<ListMissionsResponse>(missionKeys.list(wsId), (old) =>
        old && !old.missions.some((m) => m.id === mission.mission.id)
          ? { ...old, missions: [mission.mission, ...old.missions], total: old.total + 1 }
          : old,
      );
      if (mission.mission.project_id) {
        qc.setQueryData<ListMissionsResponse>(
          missionKeys.list(wsId, "active", mission.mission.project_id),
          (old) =>
            old && !old.missions.some((m) => m.id === mission.mission.id)
              ? { ...old, missions: [mission.mission, ...old.missions], total: old.total + 1 }
              : old,
        );
      }
      qc.setQueryData<MissionDetail>(
        missionKeys.detail(wsId, mission.mission.id),
        mission,
      );
    },
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({ queryKey: ideaKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: missionKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: ideaKeys.detail(wsId, vars.id) });
    },
  });
}

function patchIdeaCaches(
  qc: ReturnType<typeof useQueryClient>,
  wsId: string,
  idea: Idea,
) {
  qc.setQueryData<ListIdeasResponse>(ideaKeys.list(wsId), (old) =>
    old
      ? { ...old, ideas: old.ideas.map((i) => (i.id === idea.id ? idea : i)) }
      : old,
  );
  if (idea.project_id) {
    qc.setQueryData<ListIdeasResponse>(ideaKeys.list(wsId, "active", idea.project_id), (old) =>
      old
        ? { ...old, ideas: old.ideas.map((i) => (i.id === idea.id ? idea : i)) }
        : old,
    );
  }
  qc.setQueryData<IdeaDetail>(ideaKeys.detail(wsId, idea.id), (old) =>
    old ? { ...old, idea } : old,
  );
}
