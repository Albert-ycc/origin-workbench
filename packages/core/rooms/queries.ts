import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const roomKeys = {
  all: (wsId: string) => ["rooms", wsId] as const,
  list: (wsId: string) => [...roomKeys.all(wsId), "list"] as const,
  detail: (wsId: string, id: string) => [...roomKeys.all(wsId), "detail", id] as const,
  members: (roomId: string) => ["room-members", roomId] as const,
  messages: (roomId: string) => ["room-messages", roomId] as const,
  persona: (roomId: string, agentId: string) => ["room-persona", roomId, agentId] as const,
};

export function roomsOptions(wsId: string) {
  return queryOptions({
    queryKey: roomKeys.list(wsId),
    queryFn: () => api.listRooms(),
    staleTime: Infinity,
  });
}

export function roomOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: roomKeys.detail(wsId, id),
    queryFn: () => api.getRoom(id),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function roomMessagesOptions(roomId: string) {
  return queryOptions({
    queryKey: roomKeys.messages(roomId),
    queryFn: () => api.listRoomMessages(roomId),
    enabled: !!roomId,
    staleTime: Infinity,
  });
}

export function roomMembersOptions(roomId: string) {
  return queryOptions({
    queryKey: roomKeys.members(roomId),
    queryFn: () => api.listRoomMembers(roomId),
    enabled: !!roomId,
    staleTime: Infinity,
  });
}

export function roomAgentPersonaOptions(roomId: string, agentId: string) {
  return queryOptions({
    queryKey: roomKeys.persona(roomId, agentId),
    queryFn: () => api.getRoomAgentPersona(roomId, agentId),
    enabled: !!roomId && !!agentId,
    staleTime: Infinity,
  });
}

// React hook wrappers
export { roomsOptions as useRoomsQueryOptions };
