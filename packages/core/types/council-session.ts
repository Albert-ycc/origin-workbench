export type CouncilSessionStatus = "running" | "adjourned" | "archived";
export type CouncilActivityLevel = "quiet" | "concise" | "lively";
export type CouncilParticipantRole = "convener" | "member";

export interface CouncilSession {
  id: string;
  workspace_id: string;
  convener_user_id: string | null;
  convener_agent_id: string | null;
  related_mission_id: string | null;
  related_idea_id: string | null;
  source_chat_session_id: string | null;
  topic: string;
  summary: string;
  activity_level: CouncilActivityLevel;
  status: CouncilSessionStatus;
  conclusion: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CouncilSessionParticipant {
  id: string;
  session_id: string;
  agent_id: string;
  role: CouncilParticipantRole;
  joined_at: string;
  left_at: string | null;
}

export interface CouncilSessionDetail {
  session: CouncilSession;
  participants: CouncilSessionParticipant[];
}

export interface CreateCouncilSessionRequest {
  topic: string;
  summary?: string;
  activity_level?: CouncilActivityLevel;
  convener_agent_id?: string | null;
  related_mission_id?: string | null;
  related_idea_id?: string | null;
  source_chat_session_id?: string | null;
  participant_agent_ids?: string[];
}

export interface UpdateCouncilSessionRequest {
  topic?: string;
  summary?: string;
  activity_level?: CouncilActivityLevel;
  conclusion?: string;
}

export interface AdjournCouncilSessionRequest {
  conclusion?: string;
}

export interface AddCouncilParticipantRequest {
  agent_id: string;
  role?: CouncilParticipantRole;
}

export interface ListCouncilSessionsResponse {
  sessions: CouncilSession[];
  total: number;
}
