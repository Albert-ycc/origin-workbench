import type { Issue, IssueReaction } from "./issue";
import type { Agent, AgentMemory, AgentSkillCandidate } from "./agent";
import type { InboxItem } from "./inbox";
import type { Comment, Reaction } from "./comment";
import type { TimelineEntry } from "./activity";
import type { Workspace, MemberWithUser, Invitation } from "./workspace";
import type { Project } from "./project";
import type { Label } from "./label";
import type { TeamMessage } from "./team";
import type { MeetingInsightCard, MeetingSession, MeetingTranscriptSegment } from "./meeting";

// WebSocket event types (matching Go server protocol/events.go)
export type WSEventType =
  | "issue:created"
  | "issue:updated"
  | "issue:deleted"
  | "comment:created"
  | "comment:updated"
  | "comment:deleted"
  | "agent:status"
  | "agent:created"
  | "agent:archived"
  | "agent:restored"
  | "agent:memory_created"
  | "agent:memory_confirmed"
  | "agent:memory_rejected"
  | "agent:skill_candidate_created"
  | "agent:skill_candidate_confirmed"
  | "agent:skill_candidate_rejected"
  | "agent:event_created"
  | "task:queued"
  | "task:dispatch"
  | "task:progress"
  | "task:completed"
  | "task:failed"
  | "task:message"
  | "task:cancelled"
  | "inbox:new"
  | "inbox:read"
  | "inbox:archived"
  | "inbox:batch-read"
  | "inbox:batch-archived"
  | "workspace:updated"
  | "workspace:deleted"
  | "member:added"
  | "member:updated"
  | "member:removed"
  | "daemon:heartbeat"
  | "daemon:register"
  | "skill:created"
  | "skill:updated"
  | "skill:deleted"
  | "subscriber:added"
  | "subscriber:removed"
  | "activity:created"
  | "reaction:added"
  | "reaction:removed"
  | "issue_reaction:added"
  | "issue_reaction:removed"
  | "chat:message"
  | "chat:done"
  | "chat:session_read"
  | "project:created"
  | "project:updated"
  | "project:deleted"
  | "project:memory_doc_updated"
  | "meeting:created"
  | "meeting:updated"
  | "meeting:started"
  | "meeting:stopped"
  | "meeting:deleted"
  | "meeting:transcript_segment_created"
  | "meeting:transcript_segment_updated"
  | "meeting:transcript_segment_deleted"
  | "meeting:asr_job_updated"
  | "meeting:insight_created"
  | "meeting:insight_updated"
  | "meeting:strong_alert_created"
  | "meeting:summary_created"
  | "meeting:analysis_status_updated"
  | "label:created"
  | "label:updated"
  | "label:deleted"
  | "issue_labels:changed"
  | "pin:created"
  | "pin:deleted"
  | "pin:reordered"
  | "invitation:created"
  | "invitation:accepted"
  | "invitation:declined"
  | "invitation:revoked"
  | "mission:created"
  | "mission:updated"
  | "mission:archived"
  | "team:created"
  | "team:updated"
  | "team:archived"
  | "team:deleted"
  | "team:member_added"
  | "team:member_removed"
  | "team:message_created"
  | "room:message"
  | "task:message_chunk"
  | "task:message_complete";

export interface WSMessage<T = unknown> {
  type: WSEventType;
  payload: T;
  actor_id?: string;
}

export interface IssueCreatedPayload {
  issue: Issue;
}

export interface IssueUpdatedPayload {
  issue: Issue;
}

export interface IssueDeletedPayload {
  issue_id: string;
}

export interface IssueLabelsChangedPayload {
  issue_id: string;
  labels: Label[];
}

export interface AgentStatusPayload {
  agent: Agent;
}

export interface AgentCreatedPayload {
  agent: Agent;
}

export interface AgentArchivedPayload {
  agent: Agent;
}

export interface AgentRestoredPayload {
  agent: Agent;
}

export interface AgentMemoryCreatedPayload {
  agent_id: string;
  memory?: AgentMemory;
}

export interface AgentSkillCandidateCreatedPayload {
  agent_id: string;
  candidate?: AgentSkillCandidate;
}

export interface AgentEventCreatedPayload {
  agent_id: string;
}

export interface InboxNewPayload {
  item: InboxItem;
}

export interface InboxReadPayload {
  item_id: string;
  recipient_id: string;
}

export interface InboxArchivedPayload {
  item_id: string;
  recipient_id: string;
}

export interface InboxBatchReadPayload {
  recipient_id: string;
  count: number;
}

export interface InboxBatchArchivedPayload {
  recipient_id: string;
  count: number;
}

interface IssueSourceEventPayload {
  source_team_message_id?: string | null;
  source_team_session_id?: string | null;
}

export interface CommentCreatedPayload extends IssueSourceEventPayload {
  comment: Comment;
}

export interface CommentUpdatedPayload extends IssueSourceEventPayload {
  comment: Comment;
}

export interface CommentDeletedPayload extends IssueSourceEventPayload {
  comment_id: string;
  issue_id: string;
}

export interface WorkspaceUpdatedPayload {
  workspace: Workspace;
}

export interface WorkspaceDeletedPayload {
  workspace_id: string;
}

export interface MeetingSessionPayload {
  meeting: MeetingSession;
}

export interface MeetingTranscriptSegmentCreatedPayload {
  meeting_id: string;
  segment: MeetingTranscriptSegment;
}

export interface MeetingTranscriptSegmentUpdatedPayload {
  meeting_id: string;
  segment: MeetingTranscriptSegment;
}

export interface MeetingTranscriptSegmentDeletedPayload {
  meeting_id: string;
  segment_id: string;
}

export interface MeetingInsightCardPayload {
  meeting_id: string;
  card: MeetingInsightCard;
}

export interface MeetingSummaryCreatedPayload {
  meeting_id: string;
}

export interface MemberUpdatedPayload {
  member: MemberWithUser;
}

export interface MemberAddedPayload {
  member: MemberWithUser;
  workspace_id: string;
  workspace_name?: string;
}

export interface MemberRemovedPayload {
  member_id: string;
  user_id: string;
  workspace_id: string;
}

export interface SubscriberAddedPayload extends IssueSourceEventPayload {
  issue_id: string;
  user_type: string;
  user_id: string;
  reason: string;
}

export interface SubscriberRemovedPayload extends IssueSourceEventPayload {
  issue_id: string;
  user_type: string;
  user_id: string;
}

export interface ActivityCreatedPayload extends IssueSourceEventPayload {
  issue_id: string;
  entry: TimelineEntry;
}

export interface TaskMessagePayload {
  task_id: string;
  issue_id: string;
  chat_session_id?: string;
  seq: number;
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error";
  tool?: string;
  content?: string;
  input?: Record<string, unknown>;
  output?: string;
}

export interface TaskQueuedPayload {
  task_id: string;
  agent_id: string;
  issue_id: string;
  chat_session_id?: string;
  status: string;
}

export interface TaskDispatchPayload {
  task_id: string;
  agent_id: string;
  issue_id: string;
  runtime_id: string;
  chat_session_id?: string;
}

export interface TaskCompletedPayload {
  task_id: string;
  agent_id: string;
  issue_id: string;
  chat_session_id?: string;
  status: string;
}

export interface TaskFailedPayload {
  task_id: string;
  agent_id: string;
  issue_id: string;
  chat_session_id?: string;
  status: string;
}

export interface TaskCancelledPayload {
  task_id: string;
  agent_id: string;
  issue_id: string;
  chat_session_id?: string;
  status: string;
}

export interface ReactionAddedPayload extends IssueSourceEventPayload {
  reaction: Reaction;
  issue_id: string;
}

export interface ReactionRemovedPayload extends IssueSourceEventPayload {
  comment_id: string;
  issue_id: string;
  emoji: string;
  actor_type: string;
  actor_id: string;
}

export interface IssueReactionAddedPayload extends IssueSourceEventPayload {
  reaction: IssueReaction;
  issue_id: string;
}

export interface IssueReactionRemovedPayload extends IssueSourceEventPayload {
  issue_id: string;
  emoji: string;
  actor_type: string;
  actor_id: string;
}

export interface ChatMessageEventPayload {
  chat_session_id: string;
  message_id: string;
  role: "user" | "assistant";
  content: string;
  task_id?: string;
  created_at: string;
}

export interface ChatDonePayload {
  chat_session_id: string;
  task_id: string;
  content?: string;
}

export interface ChatSessionReadPayload {
  chat_session_id: string;
}

export interface ProjectCreatedPayload {
  project: Project;
}

export interface ProjectUpdatedPayload {
  project: Project;
}

export interface ProjectDeletedPayload {
  project_id: string;
}

export interface InvitationCreatedPayload {
  invitation: Invitation;
  workspace_name?: string;
}

export interface InvitationAcceptedPayload {
  invitation_id: string;
  member: MemberWithUser;
}

export interface InvitationDeclinedPayload {
  invitation_id: string;
  invitee_email: string;
}

export interface InvitationRevokedPayload {
  invitation_id: string;
  invitee_email: string;
}

export interface TeamMessageCreatedPayload {
  team_id: string;
  // v1.2 — present when the message belongs to a project main chat
  // (chat_session has both team_id and project_id). Used by realtime sync
  // to invalidate the project workspace's chat cache without polling.
  project_id?: string;
  event?: string | null;
  chat_session_id?: string | null;
  source_team_message_id?: string | null;
  source_team_session_id?: string | null;
  issue_id?: string | null;
  message?: TeamMessage;
}

// v1.0.14 — streaming chunk events for room messages
export interface TaskMessageChunkPayload {
  task_id: string;
  chat_session_id: string;
  message_id: string;
  chunk: string;
}

export interface TaskMessageCompletePayload {
  task_id: string;
  chat_session_id: string;
  message_id: string;
  content: string;
  input_tokens?: number;
  output_tokens?: number;
}

// v1.0.14 — flat room message event (扁平结构，不嵌套)
export interface RoomMessagePayload {
  room_id: string;
  message_id: string;
  sender_type: "user" | "agent" | "system";
  sender_id: string;
  sender_name?: string;
  content: string;
  reply_to_message_id?: string | null;
  mentions?: string[];
  is_autonomous: boolean;
  created_at: string;
}
