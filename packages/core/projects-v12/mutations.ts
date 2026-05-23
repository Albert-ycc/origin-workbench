import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { explorationKeys } from "../explorations/queries";
import { ideaKeys } from "../ideas/queries";
import { meetingKeys } from "../meetings/queries";
import { missionKeys } from "../missions/queries";
import { toolBindingKeys } from "../tool-bindings/queries";
import type {
  CreateProjectV12Request,
  UpdateProjectV12Request,
  AppendMemoryDocRequest,
} from "../types";
import { projectV12Keys } from "./queries";

export function useCreateProjectV12(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProjectV12Request) => api.createProjectV12(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectV12Keys.all(wsId) });
    },
  });
}

export function useUpdateProjectV12(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProjectV12Request }) =>
      api.updateProjectV12(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: projectV12Keys.all(wsId) });
      qc.invalidateQueries({ queryKey: projectV12Keys.detail(wsId, id) });
    },
  });
}

export function useArchiveProjectV12(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveProjectV12(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectV12Keys.all(wsId) });
    },
  });
}

export function useDeleteProjectV12(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProjectV12(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: projectV12Keys.detail(wsId, id) });
      qc.removeQueries({ queryKey: projectV12Keys.mainChat(wsId, id) });
      qc.removeQueries({ queryKey: projectV12Keys.mainChatMessages(wsId, id) });
      qc.removeQueries({ queryKey: projectV12Keys.archivedSessions(wsId, id) });
      qc.invalidateQueries({ queryKey: projectV12Keys.all(wsId) });
      qc.invalidateQueries({ queryKey: missionKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: ideaKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: explorationKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: meetingKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: toolBindingKeys.all(wsId) });
    },
  });
}

export function useAppendProjectMemoryDoc(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AppendMemoryDocRequest }) =>
      api.appendProjectMemoryDoc(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: projectV12Keys.detail(wsId, id) });
    },
  });
}

export function usePostProjectMainChatMessage(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      content,
      skill_ids,
    }: {
      projectId: string;
      content: string;
      skill_ids?: string[];
    }) => api.postProjectMainChatMessage(projectId, { content, skill_ids }),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({
        queryKey: projectV12Keys.mainChatMessages(wsId, projectId),
      });
    },
  });
}

export function usePinChatMessageToProjectMemory(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      messageId,
      note,
    }: {
      projectId: string;
      messageId: string;
      note?: string;
    }) =>
      api.pinChatMessageToProjectMemory(projectId, {
        message_id: messageId,
        note,
      }),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: projectV12Keys.detail(wsId, projectId) });
    },
  });
}

export function usePreviewProjectCompaction() {
  return useMutation({
    mutationFn: (projectId: string) => api.previewProjectCompaction(projectId),
  });
}

export function useStartProjectCompactionPreviewJob() {
  return useMutation({
    mutationFn: (projectId: string) => api.startProjectCompactionPreviewJob(projectId),
  });
}

export function useConfirmProjectCompaction(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      data,
    }: {
      projectId: string;
      data: import("../types").ConfirmCompactionRequest;
    }) => api.confirmProjectCompaction(projectId, data),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: projectV12Keys.detail(wsId, projectId) });
      qc.invalidateQueries({
        queryKey: projectV12Keys.mainChatMessages(wsId, projectId),
      });
      qc.invalidateQueries({
        queryKey: projectV12Keys.mainChat(wsId, projectId),
      });
      qc.invalidateQueries({
        queryKey: projectV12Keys.archivedSessions(wsId, projectId),
      });
    },
  });
}
