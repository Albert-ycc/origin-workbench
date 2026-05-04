import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { toolBindingKeys } from "./queries";
import type {
  CreateToolBindingRequest,
  ToolBinding,
  UpdateToolBindingRequest,
} from "../types";

export function useCreateToolBinding() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateToolBindingRequest) => api.createToolBinding(data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: toolBindingKeys.all(wsId) });
    },
  });
}

export function useUpdateToolBinding() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateToolBindingRequest) =>
      api.updateToolBinding(id, data),
    onSuccess: (binding: ToolBinding) => {
      // Optimistic-ish: every list cache that contains this binding gets the
      // patched row. Cheaper than re-fetching every potential filter combo.
      qc.getQueryCache().findAll({ queryKey: toolBindingKeys.all(wsId) }).forEach((entry) => {
        const data = entry.state.data as { bindings: ToolBinding[]; total: number } | undefined;
        if (!data) return;
        if (!data.bindings.some((b) => b.id === binding.id)) return;
        qc.setQueryData(entry.queryKey, {
          ...data,
          bindings: data.bindings.map((b) => (b.id === binding.id ? binding : b)),
        });
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: toolBindingKeys.all(wsId) });
    },
  });
}

export function useDeleteToolBinding() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.deleteToolBinding(id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: toolBindingKeys.all(wsId) });
    },
  });
}
