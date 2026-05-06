import type { Label } from "./label";

export type IssueStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "cancelled";

export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

export type IssueAssigneeType = "member" | "agent";

export interface IssueReaction {
  id: string;
  issue_id: string;
  actor_type: string;
  actor_id: string;
  emoji: string;
  created_at: string;
}

export interface Issue {
  id: string;
  workspace_id: string;
  number: number;
  identifier: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  assignee_type: IssueAssigneeType | null;
  assignee_id: string | null;
  creator_type: IssueAssigneeType;
  creator_id: string;
  parent_issue_id: string | null;
  project_id: string | null;
  position: number;
  due_date: string | null;
  reactions?: IssueReaction[];
  labels?: Label[];
  created_at: string;
  updated_at: string;
  // 团队群聊派活回链 (Origin §17 D 方案)。captain 在群聊里 @ 派的 issue
  // 这两个字段指回派活来自的 captain message + 群聊 session。普通 issue
  // 这两个字段都是 undefined。
  source_team_message_id?: string | null;
  source_team_session_id?: string | null;
}

export type DelegationTaskCardStatus = IssueStatus;

export interface DelegationTaskCard {
  issue_id: string;
  issue_key: string;
  workspace_id: string;
  number: number;
  title: string;
  status: DelegationTaskCardStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_avatar_url: string | null;
  source_team_message_id: string | null;
  source_team_session_id: string | null;
  project_id: string | null;
  latest_result_preview: string | null;
  latest_result_comment_id: string | null;
  comment_count: number;
  updated_at: string;
}
