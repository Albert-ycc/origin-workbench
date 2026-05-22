/**
 * Room (茶水间) types — wire shape mirrors server/internal/handler/room.go
 * v1.0.14: backend to implement corresponding endpoints.
 */

export interface Room {
  id: string;
  workspace_id: string;
  name: string;
  description?: string | null;
  theme?: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  last_active_at?: string;
}

export interface RoomMember {
  id: string;
  room_id: string;
  member_type: "user" | "agent";
  member_id: string;
  agent_id?: string;
  role: "owner" | "participant";
  joined_at: string;
  left_at?: string | null;
}

export interface RoomMessage {
  id: string;
  room_id: string;
  sender_type: "user" | "agent" | "system";
  sender_id: string;
  sender_name?: string | null;
  content: string;
  reply_to_message_id?: string | null;
  mentions?: string[];
  is_autonomous: boolean;
  created_at: string;
}

export interface RoomAgentPersona {
  room_id: string;
  agent_id: string;
  persona_override?: string | null;
  updated_at: string;
}

export interface CreateRoomRequest {
  name: string;
  description?: string;
  agent_ids?: string[];
}

export interface UpdateRoomRequest {
  name?: string;
  description?: string;
}

export interface AddRoomMemberRequest {
  member_type?: "user" | "agent";
  member_id?: string;
  agent_id?: string;
  role?: "owner" | "participant";
}

export interface SendRoomMessageRequest {
  content: string;
  reply_to_message_id?: string;
  mentions?: string[];
  mention_agent_ids?: string[];
}

export interface UpsertRoomAgentPersonaRequest {
  persona_override?: string;
}

export interface ListRoomsResponse {
  rooms: Room[];
  total: number;
}

export interface ListRoomMembersResponse {
  members: RoomMember[];
}

export interface ListRoomMessagesResponse {
  messages: RoomMessage[];
  next_cursor?: string | null;
}
