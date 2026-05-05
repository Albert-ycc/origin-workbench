package daemon

import "encoding/json"

// AgentEntry describes a single available agent CLI.
type AgentEntry struct {
	Path  string // path to CLI binary
	Model string // model override (optional)
}

// Runtime represents a registered daemon runtime.
type Runtime struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	Status   string `json:"status"`
}

// RepoData holds repository information from the workspace.
type RepoData struct {
	URL string `json:"url"`
}

// ProjectResourceData mirrors handler.ProjectResourceData — a single project
// resource as delivered to the daemon. resource_ref is type-specific JSON.
type ProjectResourceData struct {
	ID           string          `json:"id"`
	ResourceType string          `json:"resource_type"`
	ResourceRef  json.RawMessage `json:"resource_ref"`
	Label        string          `json:"label,omitempty"`
}

// TeamMemberData describes one roster member for a team chat task.
type TeamMemberData struct {
	AgentID string `json:"agent_id"`
	Name    string `json:"name"`
	Role    string `json:"role"`
}

// Task represents a claimed task from the server.
// Agent data (name, skills) is populated by the claim endpoint.
type Task struct {
	ID               string                `json:"id"`
	AgentID          string                `json:"agent_id"`
	RuntimeID        string                `json:"runtime_id"`
	IssueID          string                `json:"issue_id"`
	WorkspaceID      string                `json:"workspace_id"`
	Agent            *AgentData            `json:"agent,omitempty"`
	Repos            []RepoData            `json:"repos,omitempty"`
	ProjectID        string                `json:"project_id,omitempty"`        // issue's project (v1.0) or chat_session's v1.2 project workspace, when present
	ProjectTitle     string                `json:"project_title,omitempty"`     // human-readable project title for context injection
	ProjectResources []ProjectResourceData `json:"project_resources,omitempty"` // project-scoped resources to expose to the agent
	// Origin §17.5 — project memory injection. ProjectMemoryDoc is the
	// shared "what this project is about" doc; AgentProjectMemory is this
	// agent's per-project视角记忆 sidecar. Both empty when a chat/issue
	// is not bound to a v1.2 project workspace.
	ProjectMemoryDoc        string                 `json:"project_memory_doc,omitempty"`
	AgentProjectMemory      string                 `json:"agent_project_memory,omitempty"`
	PriorSessionID          string                 `json:"prior_session_id,omitempty"`          // Claude session ID from a previous task on this issue
	PriorWorkDir            string                 `json:"prior_work_dir,omitempty"`            // work_dir from a previous task on this issue
	TriggerCommentID        string                 `json:"trigger_comment_id,omitempty"`        // comment that triggered this task
	TriggerCommentContent   string                 `json:"trigger_comment_content,omitempty"`   // content of the triggering comment
	TriggerAuthorType       string                 `json:"trigger_author_type,omitempty"`       // "agent" or "member" — author kind for the triggering comment
	TriggerAuthorName       string                 `json:"trigger_author_name,omitempty"`       // display name of the triggering comment author
	ChatSessionID           string                 `json:"chat_session_id,omitempty"`           // non-empty for chat tasks
	ChatMessage             string                 `json:"chat_message,omitempty"`              // user message content for chat tasks
	TeamDelegation          *TeamDelegationData    `json:"team_delegation,omitempty"`           // captain-provided instructions for delegated team chat tasks
	TeamID                  string                 `json:"team_id,omitempty"`                   // non-empty for team group chat tasks
	TeamName                string                 `json:"team_name,omitempty"`                 // team group chat name
	TeamCaptainAgentID      string                 `json:"team_captain_agent_id,omitempty"`     // captain responsible for delegation
	TeamMembers             []TeamMemberData       `json:"team_members,omitempty"`              // roster visible to the captain
	AutopilotRunID          string                 `json:"autopilot_run_id,omitempty"`          // non-empty for autopilot run_only tasks
	AutopilotID             string                 `json:"autopilot_id,omitempty"`              // autopilot that spawned this run
	AutopilotTitle          string                 `json:"autopilot_title,omitempty"`           // autopilot title used as task context
	AutopilotDescription    string                 `json:"autopilot_description,omitempty"`     // autopilot description used as task prompt
	AutopilotSource         string                 `json:"autopilot_source,omitempty"`          // manual, schedule, webhook, or api
	AutopilotTriggerPayload json.RawMessage        `json:"autopilot_trigger_payload,omitempty"` // optional trigger payload for webhook/api runs
	QuickCreatePrompt       string                 `json:"quick_create_prompt,omitempty"`       // user's natural-language input for quick-create tasks
	ProjectCompaction       *ProjectCompactionData `json:"project_compaction,omitempty"`        // async project main-chat /sync preview task
	OperatorPreferences     *OperatorPreferences   `json:"operator_preferences,omitempty"`      // Origin §14.10 — UserProfile injected as the closest layer of the system prompt
	RequestedSkills         []string               `json:"requested_skills,omitempty"`          // skills explicitly selected from chat slash menu for this turn
}

// OperatorPreferences carries the user-written identity card and communication
// style that get prepended to every agent prompt as the closest layer of the
// three-layer injection (UserProfile → Agent.long_context → Mission.bound_contexts).
// Single-user / single-workspace assumption: server hydrates this from the
// workspace's only user_profile row at claim time.
type OperatorPreferences struct {
	RoleCard           string `json:"role_card,omitempty"`
	CommunicationStyle string `json:"communication_style,omitempty"`
}

// TeamDelegationData mirrors service.TeamDelegationContext without importing
// service into the daemon package.
type TeamDelegationData struct {
	Type            string `json:"type"`
	TeamID          string `json:"team_id"`
	ChatSessionID   string `json:"chat_session_id"`
	SourceAgentID   string `json:"source_agent_id"`
	SourceAgentName string `json:"source_agent_name"`
	TargetAgentID   string `json:"target_agent_id"`
	TargetAgentName string `json:"target_agent_name"`
	SourceMessageID string `json:"source_message_id"`
	Instruction     string `json:"instruction"`
}

// ProjectCompactionData is the transcript payload for a captain /sync preview
// task. It is intentionally read-only: the agent returns one JSON draft, and
// the server turns that into a user-editable preview.
type ProjectCompactionData struct {
	ProjectID     string                     `json:"project_id"`
	ProjectTitle  string                     `json:"project_title"`
	ChatSessionID string                     `json:"chat_session_id"`
	MemoryDoc     string                     `json:"memory_doc,omitempty"`
	MessageCount  int                        `json:"message_count"`
	OldestAt      string                     `json:"oldest_at,omitempty"`
	NewestAt      string                     `json:"newest_at,omitempty"`
	Messages      []ProjectCompactionMessage `json:"messages"`
}

type ProjectCompactionMessage struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Speaker   string `json:"speaker"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

// AgentData holds agent details returned by the claim endpoint.
type AgentData struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Instructions string            `json:"instructions"`
	Skills       []SkillData       `json:"skills"`
	CustomEnv    map[string]string `json:"custom_env,omitempty"`
	CustomArgs   []string          `json:"custom_args,omitempty"`
	McpConfig    json.RawMessage   `json:"mcp_config,omitempty"`
	Model        string            `json:"model,omitempty"`
}

// SkillData represents a structured skill for task execution.
type SkillData struct {
	Name    string          `json:"name"`
	Content string          `json:"content"`
	Files   []SkillFileData `json:"files,omitempty"`
}

// SkillFileData represents a supporting file within a skill.
type SkillFileData struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// TaskUsageEntry represents token usage for a single model during a task execution.
type TaskUsageEntry struct {
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	InputTokens      int64  `json:"input_tokens"`
	OutputTokens     int64  `json:"output_tokens"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
}

// TaskResult is the outcome of executing a task.
type TaskResult struct {
	Status        string           `json:"status"`
	Comment       string           `json:"comment"`
	BranchName    string           `json:"branch_name,omitempty"`
	EnvType       string           `json:"env_type,omitempty"`
	SessionID     string           `json:"session_id,omitempty"` // Claude session ID for future resumption
	WorkDir       string           `json:"work_dir,omitempty"`   // working directory used during execution
	EnvRoot       string           `json:"-"`                    // env root dir for writing GC metadata (not sent to server)
	FailureReason string           `json:"-"`                    // classifier forwarded to FailTask on the blocked path; empty falls back to 'agent_error'
	Usage         []TaskUsageEntry `json:"usage,omitempty"`      // per-model token usage
}
