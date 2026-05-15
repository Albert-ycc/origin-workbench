import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { explorationKeys } from "./queries";
import type {
  CreateExplorationBranchRequest,
  CreateExplorationRequest,
  Exploration,
  ExplorationBranch,
  ExplorationDetail,
  ListExplorationsResponse,
  UpdateExplorationBranchRequest,
  UpdateExplorationRequest,
} from "../types";

export function useCreateExploration() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateExplorationRequest) => api.createExploration(data),
    onSuccess: (detail: ExplorationDetail) => {
      const projectId = detail.exploration.project_id;
      qc.setQueryData<ListExplorationsResponse>(
        explorationKeys.list(wsId),
        (old) =>
          old
            ? {
                ...old,
                explorations: [detail.exploration, ...old.explorations],
                total: old.total + 1,
              }
            : { explorations: [detail.exploration], total: 1 },
      );
      if (projectId) {
        qc.setQueryData<ListExplorationsResponse>(
          explorationKeys.list(wsId, "active", projectId),
          (old) =>
            old
              ? {
                  ...old,
                  explorations: [detail.exploration, ...old.explorations],
                  total: old.total + 1,
                }
              : { explorations: [detail.exploration], total: 1 },
        );
      }
      qc.setQueryData<ExplorationDetail>(
        explorationKeys.detail(wsId, detail.exploration.id),
        detail,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: explorationKeys.all(wsId) });
    },
  });
}

export function useUpdateExploration() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateExplorationRequest) =>
      api.updateExploration(id, data),
    onSuccess: (exp: Exploration) => {
      patchExplorationCaches(qc, wsId, exp);
    },
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({ queryKey: explorationKeys.detail(wsId, vars.id) });
      qc.invalidateQueries({ queryKey: explorationKeys.list(wsId) });
    },
  });
}

export function useArchiveExploration() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.archiveExploration(id),
    onSuccess: (exp: Exploration) => {
      qc.setQueryData<ListExplorationsResponse>(
        explorationKeys.list(wsId),
        (old) =>
          old
            ? {
                ...old,
                explorations: old.explorations.filter((e) => e.id !== exp.id),
                total: Math.max(0, old.total - 1),
              }
            : old,
      );
      if (exp.project_id) {
        qc.setQueryData<ListExplorationsResponse>(
          explorationKeys.list(wsId, "active", exp.project_id),
          (old) =>
            old
              ? {
                  ...old,
                  explorations: old.explorations.filter((e) => e.id !== exp.id),
                  total: Math.max(0, old.total - 1),
                }
              : old,
        );
      }
      patchExplorationCaches(qc, wsId, exp);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: explorationKeys.all(wsId) });
    },
  });
}

export function useDeleteExploration() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.deleteExploration(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<ListExplorationsResponse>(
        explorationKeys.list(wsId),
        (old) =>
          old
            ? {
                ...old,
                explorations: old.explorations.filter((e) => e.id !== id),
                total: Math.max(0, old.total - 1),
              }
            : old,
      );
      qc.invalidateQueries({ queryKey: explorationKeys.all(wsId) });
      qc.removeQueries({ queryKey: explorationKeys.detail(wsId, id) });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: explorationKeys.all(wsId) });
    },
  });
}

export function useCreateExplorationBranch() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({
      explorationId,
      ...data
    }: { explorationId: string } & CreateExplorationBranchRequest) =>
      api.createExplorationBranch(explorationId, data),
    onSuccess: (branch: ExplorationBranch) => {
      qc.setQueryData<ExplorationDetail>(
        explorationKeys.detail(wsId, branch.exploration_id),
        (old) => (old ? { ...old, branches: [...old.branches, branch] } : old),
      );
    },
    onSettled: (branch) => {
      if (branch) {
        qc.invalidateQueries({
          queryKey: explorationKeys.detail(wsId, branch.exploration_id),
        });
      }
    },
  });
}

export function useUpdateExplorationBranch() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({
      explorationId,
      branchId,
      ...data
    }: {
      explorationId: string;
      branchId: string;
    } & UpdateExplorationBranchRequest) =>
      api.updateExplorationBranch(explorationId, branchId, data),
    onSuccess: (branch: ExplorationBranch) => {
      qc.setQueryData<ExplorationDetail>(
        explorationKeys.detail(wsId, branch.exploration_id),
        (old) =>
          old
            ? {
                ...old,
                branches: old.branches.map((b) =>
                  b.id === branch.id ? branch : b,
                ),
              }
            : old,
      );
    },
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({
        queryKey: explorationKeys.detail(wsId, vars.explorationId),
      });
    },
  });
}

export function useDeleteExplorationBranch() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({
      explorationId,
      branchId,
    }: {
      explorationId: string;
      branchId: string;
    }) => api.deleteExplorationBranch(explorationId, branchId),
    onSuccess: (_data, vars) => {
      qc.setQueryData<ExplorationDetail>(
        explorationKeys.detail(wsId, vars.explorationId),
        (old) =>
          old
            ? {
                ...old,
                branches: old.branches.filter((b) => b.id !== vars.branchId),
              }
            : old,
      );
    },
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({
        queryKey: explorationKeys.detail(wsId, vars.explorationId),
      });
    },
  });
}

function patchExplorationCaches(
  qc: ReturnType<typeof useQueryClient>,
  wsId: string,
  exp: Exploration,
) {
  qc.setQueryData<ListExplorationsResponse>(
    explorationKeys.list(wsId),
    (old) =>
      old
        ? {
            ...old,
            explorations: old.explorations.map((e) =>
              e.id === exp.id ? exp : e,
            ),
          }
        : old,
  );
  if (exp.project_id) {
    qc.setQueryData<ListExplorationsResponse>(
      explorationKeys.list(wsId, "active", exp.project_id),
      (old) =>
        old
          ? {
              ...old,
              explorations: old.explorations.map((e) =>
                e.id === exp.id ? exp : e,
              ),
            }
          : old,
    );
  }
  qc.setQueryData<ExplorationDetail>(
    explorationKeys.detail(wsId, exp.id),
    (old) => (old ? { ...old, exploration: exp } : old),
  );
}
