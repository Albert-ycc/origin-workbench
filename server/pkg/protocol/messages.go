package protocol

import "encoding/json"

// Message is the envelope for all WebSocket messages.
type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// TaskDispatchPayload is sent from server to daemon when a task is assigned.
type TaskDispatchPayload struct {
	TaskID      string `json:"task_id"`
	IssueID     string `json:"issue_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// TaskAvailablePayload is sent from server to daemon as a wakeup hint. The
// daemon still claims work through the existing HTTP claim endpoint.
type TaskAvailablePayload struct {
	RuntimeID string `json:"runtime_id"`
	TaskID    string `json:"task_id,omitempty"`
}

// TaskProgressPayload is sent from daemon to server during task execution.
type TaskProgressPayload struct {
	TaskID  string `json:"task_id"`
	Summary string `json:"summary"`
	Step    int    `json:"step,omitempty"`
	Total   int    `json:"total,omitempty"`
}

// TaskCompletedPayload is sent from daemon to server when a task finishes.
type TaskCompletedPayload struct {
	TaskID string `json:"task_id"`
	PRURL  string `json:"pr_url,omitempty"`
	Output string `json:"output,omitempty"`
}

// TaskMessagePayload represents a single agent execution message (tool call, text, etc.)
type TaskMessagePayload struct {
	TaskID  string         `json:"task_id"`
	IssueID string         `json:"issue_id,omitempty"`
	Seq     int            `json:"seq"`
	Type    string         `json:"type"`              // "text", "tool_use", "tool_result", "error"
	Tool    string         `json:"tool,omitempty"`    // tool name for tool_use/tool_result
	Content string         `json:"content,omitempty"` // text content
	Input   map[string]any `json:"input,omitempty"`   // tool input (tool_use only)
	Output  string         `json:"output,omitempty"`  // tool output (tool_result only)
}

// TaskMessageChunkPayload 是流式输出期间每个 token delta 的 WS payload。
// 对应事件类型 task:message_chunk。
// 前端：按 message_id 找到占位气泡，追加 chunk 文本。
type TaskMessageChunkPayload struct {
	TaskID        string `json:"task_id"`
	ChatSessionID string `json:"chat_session_id,omitempty"`
	MessageID     string `json:"message_id"` // 流中所有 chunk 共享同一 message_id
	Chunk         string `json:"chunk"`      // 本次增量文本
}

// TaskMessageCompletePayload 是流式输出完成后发送一次的 WS payload。
// 对应事件类型 task:message_complete。
// 前端：用 content 替换占位气泡的累加缓冲区，同时更新 token 计数。
type TaskMessageCompletePayload struct {
	TaskID        string `json:"task_id"`
	ChatSessionID string `json:"chat_session_id,omitempty"`
	MessageID     string `json:"message_id"` // 与 chunk 事件相同 message_id
	Content       string `json:"content"`    // 完整消息文本
	InputTokens   int64  `json:"input_tokens,omitempty"`
	OutputTokens  int64  `json:"output_tokens,omitempty"`
}

// DaemonRegisterPayload is sent from daemon to server on connection.
type DaemonRegisterPayload struct {
	DaemonID string        `json:"daemon_id"`
	AgentID  string        `json:"agent_id"`
	Runtimes []RuntimeInfo `json:"runtimes"`
}

// RuntimeInfo describes an available agent runtime on the daemon's machine.
type RuntimeInfo struct {
	Type    string `json:"type"`
	Version string `json:"version"`
	Status  string `json:"status"`
}

// ChatMessagePayload is broadcast when a new chat message is created.
type ChatMessagePayload struct {
	ChatSessionID string `json:"chat_session_id"`
	MessageID     string `json:"message_id"`
	Role          string `json:"role"`
	Content       string `json:"content"`
	TaskID        string `json:"task_id,omitempty"`
	CreatedAt     string `json:"created_at"`
}

// ChatDonePayload is broadcast when an agent finishes responding to a chat message.
type ChatDonePayload struct {
	ChatSessionID string `json:"chat_session_id"`
	TaskID        string `json:"task_id"`
	Content       string `json:"content"`
}

// ChatSessionReadPayload is broadcast when the creator marks a session as read.
// Fires to other devices so their unread counts stay in sync.
type ChatSessionReadPayload struct {
	ChatSessionID string `json:"chat_session_id"`
}

// DaemonHeartbeatRequestPayload is sent from daemon to server over WebSocket
// to update last_seen_at and pull pending actions for a single runtime.
// Mirrors the body of POST /api/daemon/heartbeat so both transports share
// identical semantics.
type DaemonHeartbeatRequestPayload struct {
	RuntimeID string `json:"runtime_id"`
}

// DaemonHeartbeatAckPayload is the server's reply to DaemonHeartbeatRequestPayload.
// JSON shape mirrors the HTTP heartbeat response so daemon code can decode either.
type DaemonHeartbeatAckPayload struct {
	RuntimeID               string                                  `json:"runtime_id"`
	Status                  string                                  `json:"status"`
	PendingUpdate           *DaemonHeartbeatPendingUpdate           `json:"pending_update,omitempty"`
	PendingModelList        *DaemonHeartbeatPendingModelList        `json:"pending_model_list,omitempty"`
	PendingLocalSkills      *DaemonHeartbeatPendingLocalSkills      `json:"pending_local_skills,omitempty"`
	PendingLocalSkillImport *DaemonHeartbeatPendingLocalSkillImport `json:"pending_local_skill_import,omitempty"`
}

// DaemonHeartbeatPendingUpdate describes a CLI-update action the daemon
// should run for the runtime.
type DaemonHeartbeatPendingUpdate struct {
	ID            string `json:"id"`
	TargetVersion string `json:"target_version"`
}

// DaemonHeartbeatPendingModelList describes a request for the daemon to
// enumerate the runtime's supported models.
type DaemonHeartbeatPendingModelList struct {
	ID string `json:"id"`
}

// DaemonHeartbeatPendingLocalSkills describes a request for the runtime's
// local-skill inventory.
type DaemonHeartbeatPendingLocalSkills struct {
	ID string `json:"id"`
}

// DaemonHeartbeatPendingLocalSkillImport describes a request to import a
// specific runtime local skill.
type DaemonHeartbeatPendingLocalSkillImport struct {
	ID       string `json:"id"`
	SkillKey string `json:"skill_key"`
}

// RoomMessagePayload 是客厅新消息的 WS 广播 payload（事件类型 room:message）。
// 扁平结构，前端按 room_id 路由到对应客厅渲染。
// agent 流式回复的 token 增量仍走 task:message_chunk / task:message_complete，
// 前端通过 message_id 匹配客厅消息占位气泡后替换内容。
type RoomMessagePayload struct {
	RoomID           string   `json:"room_id"`
	MessageID        string   `json:"message_id"`
	SenderType       string   `json:"sender_type"`
	SenderID         string   `json:"sender_id"`
	SenderName       string   `json:"sender_name,omitempty"`
	Content          string   `json:"content"`
	ReplyToMessageID *string  `json:"reply_to_message_id,omitempty"`
	Mentions         []string `json:"mentions,omitempty"`
	IsAutonomous     bool     `json:"is_autonomous"`
	CreatedAt        string   `json:"created_at"`
}

// CouncilRelayPayload 是 council @全体 relay 链生命周期事件
// （council:relay_started / relay_turn_completed / relay_cancelled /
// relay_finished）的 WS 广播 payload。扁平结构，前端按 council_session_id
// 路由到对应 council / team 房间渲染接力状态。
type CouncilRelayPayload struct {
	CouncilSessionID string `json:"council_session_id"`
	ChatSessionID    string `json:"chat_session_id"`
	Role             string `json:"role"`                       // lead / follower / salon_speaker
	SpeakerAgentID   string `json:"speaker_agent_id,omitempty"` // 本轮发言人
	SpeakerName      string `json:"speaker_name,omitempty"`
	TurnIndex        int    `json:"turn_index,omitempty"` // salon 当前轮（1-based）
	MaxTurns         int    `json:"max_turns,omitempty"`  // salon 总轮数
	PriorSpeakerName string `json:"prior_speaker_name,omitempty"`
}
