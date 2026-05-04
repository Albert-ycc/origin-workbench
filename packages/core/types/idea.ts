import type {
  CreateMissionPlanItemRequest,
  MissionDetail,
  MissionExecutionMode,
  MissionRiskLevel,
} from "./mission";

export type IdeaStatus = "draft" | "nurturing" | "promoted" | "archived";
export type IdeaSource = "manual" | "from_chat" | "from_external";
export type IdeaNoteKind = "new_angle" | "related_history" | "external_reference" | "question";

export interface Idea {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  nurturer_agent_id: string | null;
  promoted_mission_id: string | null;
  title: string;
  description: string;
  source: IdeaSource;
  source_ref: string;
  status: IdeaStatus;
  tags: string[];
  last_nurtured_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdeaNurtureNote {
  id: string;
  idea_id: string;
  author_agent_id: string | null;
  kind: IdeaNoteKind;
  summary: string;
  body: string;
  references_payload: unknown;
  created_at: string;
}

export interface IdeaDetail {
  idea: Idea;
  notes: IdeaNurtureNote[];
}

export interface CreateIdeaRequest {
  title?: string;
  description?: string;
  source?: IdeaSource;
  source_ref?: string;
  tags?: string[];
  nurturer_agent_id?: string | null;
}

export interface UpdateIdeaRequest {
  title?: string;
  description?: string;
  status?: IdeaStatus;
  nurturer_agent_id?: string | null;
  tags?: string[];
}

export interface CreateIdeaNoteRequest {
  kind?: IdeaNoteKind;
  summary: string;
  body?: string;
  author_agent_id?: string | null;
  references_payload?: unknown;
}

export interface PromoteIdeaRequest {
  title?: string;
  captain_agent_id: string;
  member_agent_ids?: string[];
  team_id?: string;
  risk_level?: MissionRiskLevel;
  execution_mode?: MissionExecutionMode;
  plan_items?: CreateMissionPlanItemRequest[];
}

export interface PromoteIdeaResponse {
  idea: Idea;
  mission: MissionDetail;
}

export interface ListIdeasResponse {
  ideas: Idea[];
  total: number;
}
