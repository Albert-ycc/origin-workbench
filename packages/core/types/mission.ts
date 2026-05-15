export type MissionStatus =
  | "draft"
  | "planning"
  | "waiting_confirmation"
  | "executing"
  | "blocked"
  | "completed"
  | "archived";

export type MissionRiskLevel = "low" | "medium" | "high";
export type MissionExecutionMode = "auto" | "confirm" | "step_confirm";
export type MissionPlanPhase = "plan" | "execute" | "verify" | "ship";
export type MissionPlanStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type MissionPriority = "high" | "medium" | "low";
export type MissionAssignmentStatus =
  | "queued"
  | "dispatched"
  | "running"
  | "waiting_confirmation"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export interface Mission {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  team_id: string;
  captain_agent_id: string;
  chat_session_id: string;
  created_by_user_id: string;
  title: string;
  prompt: string;
  summary: string;
  outcome: string;
  status: MissionStatus;
  risk_level: MissionRiskLevel;
  execution_mode: MissionExecutionMode;
  created_at: string;
  updated_at: string;
}

export interface MissionPlanItem {
  id: string;
  mission_id: string;
  parent_id: string | null;
  title: string;
  description: string;
  phase: MissionPlanPhase;
  status: MissionPlanStatus;
  priority: MissionPriority;
  risk_level: MissionRiskLevel;
  assigned_agent_id: string | null;
  issue_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MissionAssignment {
  id: string;
  mission_id: string;
  plan_item_id: string | null;
  agent_id: string;
  status: MissionAssignmentStatus;
  risk_level: MissionRiskLevel;
  task_id: string | null;
  issue_id: string | null;
  output: string;
  created_at: string;
  updated_at: string;
}

export interface MissionEvent {
  id: string;
  mission_id: string;
  workspace_id: string;
  actor_type: "member" | "agent" | "system";
  actor_id: string | null;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MissionTeamMember {
  agent_id: string;
  role: "captain" | "member";
  joined_at: string;
}

export interface MissionTeam {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  captain_agent_id: string;
  created_by_user_id: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  members: MissionTeamMember[];
}

export interface MissionDetail {
  mission: Mission;
  plan_items: MissionPlanItem[];
  assignments: MissionAssignment[];
  events: MissionEvent[];
  team: MissionTeam;
}

export interface CreateMissionPlanItemRequest {
  title: string;
  description?: string;
  phase?: MissionPlanPhase;
  priority?: MissionPriority;
  risk_level?: MissionRiskLevel;
  assigned_agent_id?: string | null;
}

export interface CreateMissionRequest {
  project_id?: string;
  title?: string;
  prompt: string;
  summary?: string;
  outcome?: string;
  team_id?: string;
  captain_agent_id: string;
  member_agent_ids?: string[];
  risk_level?: MissionRiskLevel;
  execution_mode?: MissionExecutionMode;
  plan_items?: CreateMissionPlanItemRequest[];
}

export interface UpdateMissionRequest {
  title?: string;
  summary?: string;
  outcome?: string;
  status?: MissionStatus;
  risk_level?: MissionRiskLevel;
  execution_mode?: MissionExecutionMode;
  team_id?: string;
  captain_agent_id?: string;
}

export interface ListMissionsResponse {
  missions: Mission[];
  total: number;
}
