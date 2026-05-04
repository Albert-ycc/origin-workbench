package protocol

// Event types for WebSocket communication between server, web clients, and daemon.
const (
	// Issue events
	EventIssueCreated = "issue:created"
	EventIssueUpdated = "issue:updated"
	EventIssueDeleted = "issue:deleted"

	// Comment events
	EventCommentCreated       = "comment:created"
	EventCommentUpdated       = "comment:updated"
	EventCommentDeleted       = "comment:deleted"
	EventReactionAdded        = "reaction:added"
	EventReactionRemoved      = "reaction:removed"
	EventIssueReactionAdded   = "issue_reaction:added"
	EventIssueReactionRemoved = "issue_reaction:removed"

	// Agent events
	EventAgentStatus                  = "agent:status"
	EventAgentCreated                 = "agent:created"
	EventAgentArchived                = "agent:archived"
	EventAgentRestored                = "agent:restored"
	EventAgentMemoryCreated           = "agent:memory_created"
	EventAgentMemoryConfirmed         = "agent:memory_confirmed"
	EventAgentMemoryRejected          = "agent:memory_rejected"
	EventAgentSkillCandidateCreated   = "agent:skill_candidate_created"
	EventAgentSkillCandidateConfirmed = "agent:skill_candidate_confirmed"
	EventAgentSkillCandidateRejected  = "agent:skill_candidate_rejected"
	EventAgentEventCreated            = "agent:event_created"

	// Task events (server <-> daemon).
	// Each event maps to a status transition on agent_task_queue. Front-end
	// subscribes by `task:` prefix and invalidates the workspace task
	// snapshot, so the granularity here is "what does the user want to see
	// change" — not "every internal status flip".
	EventTaskQueued    = "task:queued"   // ∅ → queued (enqueue / retry create)
	EventTaskDispatch  = "task:dispatch" // queued → dispatched (daemon claim)
	EventTaskProgress  = "task:progress"
	EventTaskCompleted = "task:completed" // running → completed
	EventTaskFailed    = "task:failed"    // running → failed
	EventTaskMessage   = "task:message"
	EventTaskCancelled = "task:cancelled" // * → cancelled

	// Inbox events
	EventInboxNew           = "inbox:new"
	EventInboxRead          = "inbox:read"
	EventInboxArchived      = "inbox:archived"
	EventInboxBatchRead     = "inbox:batch-read"
	EventInboxBatchArchived = "inbox:batch-archived"

	// Workspace events
	EventWorkspaceUpdated = "workspace:updated"
	EventWorkspaceDeleted = "workspace:deleted"

	// Member events
	EventMemberAdded   = "member:added"
	EventMemberUpdated = "member:updated"
	EventMemberRemoved = "member:removed"

	// Subscriber events
	EventSubscriberAdded   = "subscriber:added"
	EventSubscriberRemoved = "subscriber:removed"

	// Activity events
	EventActivityCreated = "activity:created"

	// Skill events
	EventSkillCreated = "skill:created"
	EventSkillUpdated = "skill:updated"
	EventSkillDeleted = "skill:deleted"

	// Chat events
	EventChatMessage     = "chat:message"
	EventChatDone        = "chat:done"
	EventChatSessionRead = "chat:session_read"

	// Project events
	EventProjectCreated         = "project:created"
	EventProjectUpdated         = "project:updated"
	EventProjectDeleted         = "project:deleted"
	EventProjectResourceCreated = "project_resource:created"
	EventProjectResourceDeleted = "project_resource:deleted"

	// Label events
	EventLabelCreated       = "label:created"
	EventLabelUpdated       = "label:updated"
	EventLabelDeleted       = "label:deleted"
	EventIssueLabelsChanged = "issue_labels:changed"

	// Pin events
	EventPinCreated   = "pin:created"
	EventPinDeleted   = "pin:deleted"
	EventPinReordered = "pin:reordered"

	// Invitation events
	EventInvitationCreated  = "invitation:created"
	EventInvitationAccepted = "invitation:accepted"
	EventInvitationDeclined = "invitation:declined"
	EventInvitationRevoked  = "invitation:revoked"

	// Mission events
	EventMissionCreated  = "mission:created"
	EventMissionUpdated  = "mission:updated"
	EventMissionArchived = "mission:archived"

	// Idea events (Origin idea pool)
	EventIdeaCreated  = "idea:created"
	EventIdeaUpdated  = "idea:updated"
	EventIdeaArchived = "idea:archived"
	EventIdeaDeleted  = "idea:deleted"
	EventIdeaPromoted = "idea:promoted"
	EventIdeaNoteAdded   = "idea:note_added"
	EventIdeaNoteDeleted = "idea:note_deleted"

	// Council Session events (Origin on-demand multi-agent room)
	EventCouncilCreated            = "council:created"
	EventCouncilUpdated            = "council:updated"
	EventCouncilAdjourned          = "council:adjourned"
	EventCouncilArchived           = "council:archived"
	EventCouncilDeleted            = "council:deleted"
	EventCouncilParticipantJoined = "council:participant_joined"
	EventCouncilParticipantLeft   = "council:participant_left"

	// Exploration events (Origin §14.7 Branching Exploration)
	EventExplorationCreated        = "exploration:created"
	EventExplorationUpdated        = "exploration:updated"
	EventExplorationArchived       = "exploration:archived"
	EventExplorationDeleted        = "exploration:deleted"
	EventExplorationBranchCreated  = "exploration:branch_created"
	EventExplorationBranchUpdated  = "exploration:branch_updated"
	EventExplorationBranchDeleted  = "exploration:branch_deleted"

	// ToolBinding events (Origin §14.9 — bind external tools to subjects)
	EventToolBindingCreated = "tool_binding:created"
	EventToolBindingUpdated = "tool_binding:updated"
	EventToolBindingDeleted = "tool_binding:deleted"

	// Autopilot events
	EventAutopilotCreated  = "autopilot:created"
	EventAutopilotUpdated  = "autopilot:updated"
	EventAutopilotDeleted  = "autopilot:deleted"
	EventAutopilotRunStart = "autopilot:run_start"
	EventAutopilotRunDone  = "autopilot:run_done"

	// Team events
	EventTeamCreated        = "team:created"
	EventTeamUpdated        = "team:updated"
	EventTeamArchived       = "team:archived"
	EventTeamDeleted        = "team:deleted"
	EventTeamMemberAdded    = "team:member_added"
	EventTeamMemberRemoved  = "team:member_removed"
	EventTeamMessageCreated = "team:message_created"

	// Daemon events
	EventDaemonHeartbeat     = "daemon:heartbeat"
	EventDaemonHeartbeatAck  = "daemon:heartbeat_ack"
	EventDaemonRegister      = "daemon:register"
	EventDaemonTaskAvailable = "daemon:task_available"
)
