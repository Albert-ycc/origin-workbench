export type CouncilSessionStatus = "running" | "adjourned" | "archived";
export type CouncilActivityLevel = "quiet" | "concise" | "lively";
export type CouncilParticipantRole = "convener" | "member";
// v1.0.14: "relay" 是原有的 lead/follower 决议模式；"salon" 是圆桌客厅。
export type CouncilSessionMode = "relay" | "salon";

// AI Roundtable P0 — 议事策略持久化。schema 见 server/migrations/092 注释。
// 所有字段均可选；缺省视为「未配置」。
export type CouncilRoundtableType = "brainstorm" | "review" | "decision";
export type CouncilRiskLevel = "low" | "medium" | "high";

export interface CouncilParticipantRoleSpec {
  agent_id: string;
  role: string;
  role_hint?: string;
}

export interface CouncilContextSource {
  type: "project" | "idea" | "mission" | "chat";
  id: string;
  label?: string;
}

export interface CouncilRolePerspective {
  agent_id: string;
  role: string;
  position: string;
  evidence: string;
  self_rebuttal: string;
  risk_level: CouncilRiskLevel;
  suggestion: string;
  updated_at?: string;
}

export interface CouncilDisagreementStance {
  agent_id: string;
  stance: string;
  conditions?: string;
}

export interface CouncilDisagreement {
  topic: string;
  stances: CouncilDisagreementStance[];
}

export interface CouncilConclusionStructured {
  conclusion?: string;
  disagreements?: string;
  risks?: string;
  assumptions?: string;
  action_items?: string;
  memory_candidates?: string;
}

export interface CouncilStrategy {
  roundtable_type?: CouncilRoundtableType | null;
  framework_id?: string;
  framework_label?: string;
  expected_output?: string;
  participant_roles?: CouncilParticipantRoleSpec[];
  context_sources?: CouncilContextSource[];
  role_perspectives?: CouncilRolePerspective[];
  disagreements?: CouncilDisagreement[];
  conclusion_structured?: CouncilConclusionStructured;
}

export interface CouncilSession {
  id: string;
  workspace_id: string;
  convener_user_id: string | null;
  convener_agent_id: string | null;
  related_mission_id: string | null;
  related_idea_id: string | null;
  source_chat_session_id: string | null;
  // Optional until the v1.2 backend response converter exposes project_id
  // for every session. Schema has had this column since migration 086.
  project_id?: string | null;
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
  // 默认 {}；不存在的键由消费方按缺省处理。
  strategy: CouncilStrategy;
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
  // AI Roundtable P0 — 创建时一次性带上议事策略。
  strategy?: CouncilStrategy;
}

export interface UpdateCouncilSessionRequest {
  topic?: string;
  summary?: string;
  activity_level?: CouncilActivityLevel;
  conclusion?: string;
  // AI Roundtable P0 — 用于运行中补录角色观点卡 / 分歧矩阵 / 6 段结论。
  strategy?: CouncilStrategy;
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
