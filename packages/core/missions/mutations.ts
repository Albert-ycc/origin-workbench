import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { missionKeys } from "./queries";
import type {
  CreateMissionRequest,
  ListMissionsResponse,
  Mission,
  MissionDetail,
  UpdateMissionRequest,
} from "../types";

export function useCreateMission() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateMissionRequest) => api.createMission(data),
    onSuccess: (detail) => {
      const projectId = detail.mission.project_id;
      qc.setQueryData<ListMissionsResponse>(missionKeys.list(wsId), (old) =>
        old && !old.missions.some((m) => m.id === detail.mission.id)
          ? { ...old, missions: [detail.mission, ...old.missions], total: old.total + 1 }
          : old,
      );
      if (projectId) {
        qc.setQueryData<ListMissionsResponse>(missionKeys.list(wsId, "active", projectId), (old) =>
          old && !old.missions.some((m) => m.id === detail.mission.id)
            ? { ...old, missions: [detail.mission, ...old.missions], total: old.total + 1 }
            : old,
        );
      }
      qc.setQueryData<MissionDetail>(
        missionKeys.detail(wsId, detail.mission.id),
        detail,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: missionKeys.all(wsId) });
    },
  });
}

export function useUpdateMission() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateMissionRequest) =>
      api.updateMission(id, data),
    onSuccess: (mission) => {
      patchMissionCaches(qc, wsId, mission);
    },
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({ queryKey: missionKeys.detail(wsId, vars.id) });
      qc.invalidateQueries({ queryKey: missionKeys.all(wsId) });
    },
  });
}

export function useArchiveMission() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.archiveMission(id),
    onSuccess: (mission) => {
      qc.setQueryData<ListMissionsResponse>(missionKeys.list(wsId), (old) =>
        old
          ? {
              ...old,
              missions: old.missions.filter((m) => m.id !== mission.id),
              total: Math.max(0, old.total - 1),
            }
          : old,
      );
      if (mission.project_id) {
        qc.setQueryData<ListMissionsResponse>(missionKeys.list(wsId, "active", mission.project_id), (old) =>
          old
            ? {
                ...old,
                missions: old.missions.filter((m) => m.id !== mission.id),
                total: Math.max(0, old.total - 1),
              }
            : old,
        );
      }
      qc.invalidateQueries({ queryKey: missionKeys.all(wsId) });
    },
  });
}

function patchMissionCaches(
  qc: ReturnType<typeof useQueryClient>,
  wsId: string,
  mission: Mission,
) {
  qc.setQueryData<ListMissionsResponse>(missionKeys.list(wsId), (old) =>
    old
      ? {
          ...old,
          missions: old.missions.map((m) => (m.id === mission.id ? mission : m)),
        }
      : old,
  );
  if (mission.project_id) {
    qc.setQueryData<ListMissionsResponse>(missionKeys.list(wsId, "active", mission.project_id), (old) =>
      old
        ? {
            ...old,
            missions: old.missions.map((m) => (m.id === mission.id ? mission : m)),
          }
        : old,
    );
  }
  qc.setQueryData<MissionDetail>(missionKeys.detail(wsId, mission.id), (old) =>
    old ? { ...old, mission } : old,
  );
}
