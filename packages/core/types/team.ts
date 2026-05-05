/**
 * Phase 2 server-backed team types — wire shape mirrors
 * server/internal/handler/team.go::TeamResponse (and friends).
 */

export type TeamMemberRole = "captain" | "member";

export interface TeamMember {
  agent_id: string;
  role: TeamMemberRole;
  joined_at: string;
}

export interface Team {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  captain_agent_id: string;
  created_by_user_id: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  members: TeamMember[];
}

export type TeamMessageRole = "user" | "assistant";

export interface TeamMessage {
  id: string;
  chat_session_id: string;
  team_id: string;
  role: TeamMessageRole;
  content: string;
  sender_agent_id: string | null;
  created_at: string;
}

export interface CreateTeamRequest {
  name: string;
  description?: string;
  captain_agent_id: string;
  member_agent_ids: string[];
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string;
  captain_agent_id?: string;
}

export interface AddTeamMemberRequest {
  agent_id: string;
}

export interface PostTeamMessageRequest {
  content: string;
  skill_ids?: string[];
}

export interface ListTeamsResponse {
  teams: Team[];
  total: number;
}

export interface ListTeamMessagesResponse {
  messages: TeamMessage[];
  next_cursor?: string | null;
}
