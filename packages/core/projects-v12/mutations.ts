import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
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
    mutationFn: ({ projectId, content }: { projectId: string; content: string }) =>
      api.postProjectMainChatMessage(projectId, { content }),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({
        queryKey: projectV12Keys.mainChatMessages(wsId, projectId),
      });
    },
  });
}
