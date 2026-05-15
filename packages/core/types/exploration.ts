export type ExplorationStatus = "open" | "converging" | "closed" | "archived";
export type ExplorationBranchVerdict =
  | "pending"
  | "winning"
  | "runner_up"
  | "discarded";

export interface Exploration {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  created_by_user_id: string;
  related_mission_id: string | null;
  related_idea_id: string | null;
  topic: string;
  question: string;
  status: ExplorationStatus;
  decision: string;
  created_at: string;
  updated_at: string;
}

export interface ExplorationBranch {
  id: string;
  exploration_id: string;
  agent_id: string | null;
  title: string;
  // PRD §14.7 — seven required fields kept on the wire even when empty so the
  // compare panel can render every branch as a uniform table.
  core_proposal: string;
  design_logic: string;
  key_decisions: string;
  cost_estimate: string;
  risk_points: string;
  fits: string;
  does_not_fit: string;
  verdict: ExplorationBranchVerdict;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ExplorationDetail {
  exploration: Exploration;
  branches: ExplorationBranch[];
}

export interface CreateExplorationRequest {
  project_id?: string;
  topic: string;
  question?: string;
  related_mission_id?: string;
  related_idea_id?: string;
}

export interface UpdateExplorationRequest {
  topic?: string;
  question?: string;
  status?: ExplorationStatus;
  decision?: string;
}

export interface CreateExplorationBranchRequest {
  title: string;
  agent_id?: string;
  core_proposal?: string;
  design_logic?: string;
  key_decisions?: string;
  cost_estimate?: string;
  risk_points?: string;
  fits?: string;
  does_not_fit?: string;
  sort_order?: number;
}

export interface UpdateExplorationBranchRequest {
  title?: string;
  core_proposal?: string;
  design_logic?: string;
  key_decisions?: string;
  cost_estimate?: string;
  risk_points?: string;
  fits?: string;
  does_not_fit?: string;
  verdict?: ExplorationBranchVerdict;
}

export interface ListExplorationsResponse {
  explorations: Exploration[];
  total: number;
}
