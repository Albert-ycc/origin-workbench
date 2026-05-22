export type CouncilSessionStatus = "running" | "adjourned" | "archived";
export type CouncilActivityLevel = "quiet" | "concise" | "lively";
export type CouncilParticipantRole = "convener" | "member";
// v1.0.14: "relay" 是原有的 lead/follower 决议模式；"salon" 是圆桌客厅。
export type CouncilSessionMode = "relay" | "salon";

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
  mode: CouncilSessionMode;
  max_turns: number;
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
  // PRD §17.6 — bind the council to a v1.2 project workspace so the
  // adjourn hook also writes the conclusion to project.memory_doc 「关键决策」.
  project_id?: string | null;
  participant_agent_ids?: string[];
  // v1.0.14 salon 模式：mode="salon" 时后端自动建 chat_session + kickoff 首位
  // 发言者，max_turns 控制总轮数（默认 8，clamp 到 [2, 24]）。
  mode?: CouncilSessionMode;
  max_turns?: number;
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
