import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { roomKeys } from "./queries";
import type {
  CreateRoomRequest,
  UpdateRoomRequest,
  AddRoomMemberRequest,
  SendRoomMessageRequest,
  UpsertRoomAgentPersonaRequest,
} from "../types";

export function useCreateRoom() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (data: CreateRoomRequest) => api.createRoom(data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
    },
  });
}

export function useUpdateRoom(roomId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (data: UpdateRoomRequest) => api.updateRoom(roomId, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: roomKeys.detail(wsId, roomId) });
      qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
    },
  });
}

export function useArchiveRoom() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (roomId: string) => api.archiveRoom(roomId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
    },
  });
}

export function useAddRoomMember(roomId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: AddRoomMemberRequest) => api.addRoomMember(roomId, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: roomKeys.members(roomId) });
    },
  });
}

export function useRemoveRoomMember(roomId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (agentId: string) => api.removeRoomMember(roomId, agentId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: roomKeys.members(roomId) });
    },
  });
}

export function useSendRoomMessage(roomId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: SendRoomMessageRequest) => api.sendRoomMessage(roomId, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: roomKeys.messages(roomId) });
    },
  });
}

export function useUpsertRoomAgentPersona(roomId: string, agentId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: UpsertRoomAgentPersonaRequest) =>
      api.upsertRoomAgentPersona(roomId, agentId, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: roomKeys.persona(roomId, agentId) });
    },
  });
}
