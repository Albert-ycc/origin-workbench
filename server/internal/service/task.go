package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/apitools"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/mention"
	"github.com/multica-ai/multica/server/internal/modelapi"
	"github.com/multica-ai/multica/server/internal/realtime"
	"github.com/multica-ai/multica/server/internal/runtimeconfig"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
	"github.com/multica-ai/multica/server/pkg/redact"
	"github.com/multica-ai/multica/server/pkg/sanitizer"
)

type TaskService struct {
	Queries              *db.Queries
	TxStarter            TxStarter
	Hub                  *realtime.Hub
	Bus                  *events.Bus
	Wakeup               TaskWakeupNotifier
	APIChatClientFactory func(runtimeconfig.APIRuntimeConfig) apiRuntimeChatClient
	APIToolExecutor      apiRuntimeToolExecutor
	// EmptyClaim caches "this runtime has no queued task" so the daemon
	// poll path can skip a Postgres scan on the steady-state empty case.
	// Optional — a nil cache disables the fast path and every claim
	// goes through the DB. Wired in router.go from the shared Redis
	// client.
	EmptyClaim *EmptyClaimCache
}

type TaskWakeupNotifier interface {
	NotifyTaskAvailable(runtimeID, taskID string)
}

type apiRuntimeChatClient interface {
	Chat(ctx context.Context, req modelapi.ChatRequest) (modelapi.ChatResult, error)
	// ChatStream 流式调用 LLM，每个 chunk 通过 onChunk 回调推出。
	// 参见 modelapi.Client.ChatStream 的文档。
	ChatStream(ctx context.Context, req modelapi.ChatRequest, onChunk func(string) error) (modelapi.ChatResult, error)
}

type apiRuntimeToolExecutor interface {
	Tools() []modelapi.Tool
	Execute(ctx context.Context, call modelapi.ToolCall) (string, error)
}

type skillCandidate struct {
	Name        string
	Description string
	Content     string
}

// triggerSummaryMaxLen caps the snapshot length so the row stays cheap to
// transmit (it ends up in every task list response). 200 is enough for a
// recognisable preview of a one-paragraph comment.
const triggerSummaryMaxLen = 200

const apiRuntimeChatTaskTimeout = 5 * time.Minute
const apiRuntimeMaxToolRounds = 8

// truncateForSummary returns s shortened to maxRunes, with a trailing
// `…` when truncated. Operates on runes (not bytes) so multibyte characters
// — Chinese / emoji — count as one each. Strips surrounding whitespace
// first so a leading newline doesn't waste budget.
func truncateForSummary(s string, maxRunes int) string {
	// strings.Builder + Grow avoids the O(N²) realloc cycle of `+=` in
	// a loop. Grow uses byte length, which is an upper bound for the
	// rune-equivalent output (replacing \n/\r/\t with space is byte-equal
	// for ASCII whitespace), so we never reallocate.
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch r {
		case '\n', '\r', '\t':
			b.WriteByte(' ')
		default:
			b.WriteRune(r)
		}
	}
	rs := []rune(strings.TrimSpace(b.String()))
	if len(rs) <= maxRunes {
		return string(rs)
	}
	return string(rs[:maxRunes]) + "…"
}

// buildCommentTriggerSummary fetches the comment content and truncates
// it for storage on the task row. Returns an invalid pgtype.Text when
// the comment is missing (deleted / wrong workspace / etc) so the column
// stays NULL — front-end falls back to a structural label in that case.
func (s *TaskService) buildCommentTriggerSummary(ctx context.Context, commentID pgtype.UUID) pgtype.Text {
	if !commentID.Valid {
		return pgtype.Text{}
	}
	comment, err := s.Queries.GetComment(ctx, commentID)
	if err != nil {
		return pgtype.Text{}
	}
	summary := truncateForSummary(comment.Content, triggerSummaryMaxLen)
	if summary == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: summary, Valid: true}
}

func NewTaskService(q *db.Queries, tx TxStarter, hub *realtime.Hub, bus *events.Bus, wakeups ...TaskWakeupNotifier) *TaskService {
	var wakeup TaskWakeupNotifier
	if len(wakeups) > 0 {
		wakeup = wakeups[0]
	}
	return &TaskService{Queries: q, TxStarter: tx, Hub: hub, Bus: bus, Wakeup: wakeup}
}

func (s *TaskService) ensureAgentRuntimeCanQueueDaemonTask(ctx context.Context, agent db.Agent) error {
	if !agent.RuntimeID.Valid {
		return fmt.Errorf("agent has no runtime")
	}
	rt, err := s.Queries.GetAgentRuntime(ctx, agent.RuntimeID)
	if err != nil {
		return fmt.Errorf("load runtime: %w", err)
	}
	return runtimeCanQueueDaemonTask(rt)
}

func runtimeCanQueueDaemonTask(rt db.AgentRuntime) error {
	if runtimeconfig.IsAPIRuntimeMetadata(rt.Metadata) {
		return fmt.Errorf("API runtime only supports server-side chat tasks; issue and project tasks require a local runtime")
	}
	return nil
}

// EnqueueTaskForIssue creates a queued task for an agent-assigned issue.
// No context snapshot is stored — the agent fetches all data it needs at
// runtime via the multica CLI.
func (s *TaskService) EnqueueTaskForIssue(ctx context.Context, issue db.Issue, triggerCommentID ...pgtype.UUID) (db.AgentTaskQueue, error) {
	var commentID pgtype.UUID
	if len(triggerCommentID) > 0 {
		commentID = triggerCommentID[0]
	}
	return s.enqueueIssueTask(ctx, issue, commentID, false)
}

// enqueueIssueTask is the shared implementation behind EnqueueTaskForIssue
// and the manual rerun path. forceFreshSession=true marks the task so the
// daemon claim handler skips the (agent_id, issue_id) resume lookup — the
// user already judged the prior output bad, a fresh agent session is the
// expected behavior.
func (s *TaskService) enqueueIssueTask(ctx context.Context, issue db.Issue, triggerCommentID pgtype.UUID, forceFreshSession bool) (db.AgentTaskQueue, error) {
	if !issue.AssigneeID.Valid {
		slog.Error("task enqueue failed", "issue_id", util.UUIDToString(issue.ID), "error", "issue has no assignee")
		return db.AgentTaskQueue{}, fmt.Errorf("issue has no assignee")
	}

	agent, err := s.Queries.GetAgent(ctx, issue.AssigneeID)
	if err != nil {
		slog.Error("task enqueue failed", "issue_id", util.UUIDToString(issue.ID), "error", err)
		return db.AgentTaskQueue{}, fmt.Errorf("load agent: %w", err)
	}
	if agent.ArchivedAt.Valid {
		slog.Debug("task enqueue skipped: agent is archived", "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agent.ID))
		return db.AgentTaskQueue{}, fmt.Errorf("agent is archived")
	}
	if !agent.RuntimeID.Valid {
		slog.Error("task enqueue failed", "issue_id", util.UUIDToString(issue.ID), "error", "agent has no runtime")
		return db.AgentTaskQueue{}, fmt.Errorf("agent has no runtime")
	}
	if err := s.ensureAgentRuntimeCanQueueDaemonTask(ctx, agent); err != nil {
		slog.Error("task enqueue failed", "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agent.ID), "error", err)
		return db.AgentTaskQueue{}, err
	}

	task, err := s.Queries.CreateAgentTask(ctx, db.CreateAgentTaskParams{
		AgentID:           issue.AssigneeID,
		RuntimeID:         agent.RuntimeID,
		IssueID:           issue.ID,
		Priority:          priorityToInt(issue.Priority),
		TriggerCommentID:  triggerCommentID,
		TriggerSummary:    s.buildCommentTriggerSummary(ctx, triggerCommentID),
		ForceFreshSession: pgtype.Bool{Bool: forceFreshSession, Valid: forceFreshSession},
	})
	if err != nil {
		slog.Error("task enqueue failed", "issue_id", util.UUIDToString(issue.ID), "error", err)
		return db.AgentTaskQueue{}, fmt.Errorf("create task: %w", err)
	}

	slog.Info("task enqueued",
		"task_id", util.UUIDToString(task.ID),
		"issue_id", util.UUIDToString(issue.ID),
		"agent_id", util.UUIDToString(issue.AssigneeID),
		"force_fresh_session", forceFreshSession,
	)
	// Order matters: broadcast first, notify daemon second. notifyTaskAvailable
	// kicks an in-process channel that the daemon picks up over HTTP and
	// claims; the claim path then emits its own task:dispatch. Doing the
	// queued broadcast afterwards risks the dispatch event reaching clients
	// before the queued one (rare but unsafe-by-construction). Publishing
	// in the desired observe-order makes correctness independent of timing.
	s.broadcastTaskEvent(ctx, protocol.EventTaskQueued, task)
	s.notifyTaskAvailable(task)
	return task, nil
}

// EnqueueTaskForMention creates a queued task for a mentioned agent on an issue.
// Unlike EnqueueTaskForIssue, this takes an explicit agent ID rather than
// deriving it from the issue assignee.
func (s *TaskService) EnqueueTaskForMention(ctx context.Context, issue db.Issue, agentID pgtype.UUID, triggerCommentID pgtype.UUID) (db.AgentTaskQueue, error) {
	agent, err := s.Queries.GetAgent(ctx, agentID)
	if err != nil {
		slog.Error("mention task enqueue failed: agent not found", "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agentID), "error", err)
		return db.AgentTaskQueue{}, fmt.Errorf("load agent: %w", err)
	}
	if agent.ArchivedAt.Valid {
		slog.Debug("mention task enqueue skipped: agent is archived", "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agentID))
		return db.AgentTaskQueue{}, fmt.Errorf("agent is archived")
	}
	if !agent.RuntimeID.Valid {
		slog.Error("mention task enqueue failed: agent has no runtime", "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agentID))
		return db.AgentTaskQueue{}, fmt.Errorf("agent has no runtime")
	}
	if err := s.ensureAgentRuntimeCanQueueDaemonTask(ctx, agent); err != nil {
		slog.Error("mention task enqueue failed", "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agentID), "error", err)
		return db.AgentTaskQueue{}, err
	}

	task, err := s.Queries.CreateAgentTask(ctx, db.CreateAgentTaskParams{
		AgentID:          agentID,
		RuntimeID:        agent.RuntimeID,
		IssueID:          issue.ID,
		Priority:         priorityToInt(issue.Priority),
		TriggerCommentID: triggerCommentID,
		TriggerSummary:   s.buildCommentTriggerSummary(ctx, triggerCommentID),
	})
	if err != nil {
		slog.Error("mention task enqueue failed", "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agentID), "error", err)
		return db.AgentTaskQueue{}, fmt.Errorf("create task: %w", err)
	}

	slog.Info("mention task enqueued", "task_id", util.UUIDToString(task.ID), "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agentID))
	// See EnqueueTaskForIssue for ordering rationale.
	s.broadcastTaskEvent(ctx, protocol.EventTaskQueued, task)
	s.notifyTaskAvailable(task)
	return task, nil
}

// QuickCreateContext is the JSON payload stored on a quick-create task's
// context column. The daemon detects this variant via Type == "quick_create"
// and switches to the quick-create prompt template; the completion path
// uses RequesterID + WorkspaceID to write the inbox notification.
type QuickCreateContext struct {
	Type        string `json:"type"`
	Prompt      string `json:"prompt"`
	RequesterID string `json:"requester_id"`
	WorkspaceID string `json:"workspace_id"`
}

// QuickCreateContextType marks a task as a quick-create job.
const QuickCreateContextType = "quick_create"

// ProjectCompactionContext is stored on the captain's async /sync preview
// task. The full transcript is hydrated at claim/status time so the task row
// does not become a second copy of chat history.
type ProjectCompactionContext struct {
	Type          string `json:"type"`
	WorkspaceID   string `json:"workspace_id"`
	ProjectID     string `json:"project_id"`
	ChatSessionID string `json:"source_chat_session_id"`
}

// ProjectCompactionContextType marks a task as a project main-chat compaction
// preview job.
const ProjectCompactionContextType = "project_compaction"

// TeamDelegationContext is stored on a team member chat task when the
// captain delegates work by mentioning that member in the group chat.
type TeamDelegationContext struct {
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

// TeamDelegationContextType marks a chat task as captain-delegated team work.
const TeamDelegationContextType = "team_delegation"

// EnqueueQuickCreateTask creates a queued task that has no issue / chat /
// autopilot link — the user's natural-language prompt is stored in the
// task's context JSONB and the agent is expected to translate it into a
// `multica issue create` call. Pre-validates that the agent is reachable
// (not archived, has a runtime) so the API can reject up-front rather than
// queue a task no one will ever claim.
func (s *TaskService) EnqueueQuickCreateTask(ctx context.Context, workspaceID, requesterID pgtype.UUID, agentID pgtype.UUID, prompt string) (db.AgentTaskQueue, error) {
	agent, err := s.Queries.GetAgent(ctx, agentID)
	if err != nil {
		return db.AgentTaskQueue{}, fmt.Errorf("load agent: %w", err)
	}
	if agent.ArchivedAt.Valid {
		return db.AgentTaskQueue{}, fmt.Errorf("agent is archived")
	}
	if !agent.RuntimeID.Valid {
		return db.AgentTaskQueue{}, fmt.Errorf("agent has no runtime")
	}
	if err := s.ensureAgentRuntimeCanQueueDaemonTask(ctx, agent); err != nil {
		return db.AgentTaskQueue{}, err
	}

	payload := QuickCreateContext{
		Type:        QuickCreateContextType,
		Prompt:      prompt,
		RequesterID: util.UUIDToString(requesterID),
		WorkspaceID: util.UUIDToString(workspaceID),
	}
	contextJSON, err := json.Marshal(payload)
	if err != nil {
		return db.AgentTaskQueue{}, fmt.Errorf("marshal quick-create context: %w", err)
	}

	task, err := s.Queries.CreateQuickCreateTask(ctx, db.CreateQuickCreateTaskParams{
		AgentID:   agentID,
		RuntimeID: agent.RuntimeID,
		Priority:  priorityToInt("high"),
		Context:   contextJSON,
	})
	if err != nil {
		return db.AgentTaskQueue{}, fmt.Errorf("create quick-create task: %w", err)
	}

	slog.Info("quick-create task enqueued",
		"task_id", util.UUIDToString(task.ID),
		"agent_id", util.UUIDToString(agentID),
		"requester_id", util.UUIDToString(requesterID),
		"workspace_id", util.UUIDToString(workspaceID),
	)
	// Match every other Enqueue* path: kick the daemon WS so the task
	// gets claimed promptly instead of waiting for the next 30 s poll
	// cycle. Without this the user perceives "quick create never
	// triggered" because the modal closes immediately and the task
	// sits in 'queued' until the next sleepWithContextOrWakeup tick.
	s.notifyTaskAvailable(task)
	return task, nil
}

// EnqueueProjectCompactionTask creates an async captain job that produces a
// structured compaction preview for a project main chat. It uses the same
// context-only task shape as quick-create: no issue/chat/autopilot link, no
// user-visible chat row on completion.
func (s *TaskService) EnqueueProjectCompactionTask(ctx context.Context, workspaceID, projectID, chatSessionID, agentID pgtype.UUID) (db.AgentTaskQueue, error) {
	agent, err := s.Queries.GetAgent(ctx, agentID)
	if err != nil {
		return db.AgentTaskQueue{}, fmt.Errorf("load agent: %w", err)
	}
	if agent.ArchivedAt.Valid {
		return db.AgentTaskQueue{}, fmt.Errorf("agent is archived")
	}
	if !agent.RuntimeID.Valid {
		return db.AgentTaskQueue{}, fmt.Errorf("agent has no runtime")
	}
	if err := s.ensureAgentRuntimeCanQueueDaemonTask(ctx, agent); err != nil {
		return db.AgentTaskQueue{}, err
	}

	payload := ProjectCompactionContext{
		Type:          ProjectCompactionContextType,
		WorkspaceID:   util.UUIDToString(workspaceID),
		ProjectID:     util.UUIDToString(projectID),
		ChatSessionID: util.UUIDToString(chatSessionID),
	}
	contextJSON, err := json.Marshal(payload)
	if err != nil {
		return db.AgentTaskQueue{}, fmt.Errorf("marshal project compaction context: %w", err)
	}

	task, err := s.Queries.CreateQuickCreateTask(ctx, db.CreateQuickCreateTaskParams{
		AgentID:   agentID,
		RuntimeID: agent.RuntimeID,
		Priority:  priorityToInt("high"),
		Context:   contextJSON,
	})
	if err != nil {
		return db.AgentTaskQueue{}, fmt.Errorf("create project compaction task: %w", err)
	}

	slog.Info("project compaction task enqueued",
		"task_id", util.UUIDToString(task.ID),
		"agent_id", util.UUIDToString(agentID),
		"project_id", util.UUIDToString(projectID),
		"chat_session_id", util.UUIDToString(chatSessionID),
	)
	s.broadcastTaskEvent(ctx, protocol.EventTaskQueued, task)
	s.notifyTaskAvailable(task)
	return task, nil
}

// EnqueueChatTask creates a queued task for a chat session.
// Unlike issue tasks, chat tasks have no issue_id.
func (s *TaskService) EnqueueChatTask(ctx context.Context, chatSession db.ChatSession, taskContexts ...[]byte) (db.AgentTaskQueue, error) {
	if !chatSession.AgentID.Valid {
		return db.AgentTaskQueue{}, fmt.Errorf("chat session has no agent — call EnqueueChatTaskForAgent for team sessions")
	}
	return s.EnqueueChatTaskForAgent(ctx, chatSession, chatSession.AgentID, taskContexts...)
}

// EnqueueChatTaskForAgent enqueues a chat task on a specific agent. It exists
// because team chat sessions have agent_id IS NULL (the captain is recorded
// in the team table, not on the session). Callers in that path resolve the
// captain agent themselves and pass it in. Daemon protocol is unchanged: the
// task carries agent_id like any other chat task.
func (s *TaskService) EnqueueChatTaskForAgent(ctx context.Context, chatSession db.ChatSession, agentID pgtype.UUID, taskContexts ...[]byte) (db.AgentTaskQueue, error) {
	return s.enqueueChatTaskForAgent(ctx, chatSession, agentID, false, taskContexts...)
}

func (s *TaskService) EnqueueFreshChatTaskForAgent(ctx context.Context, chatSession db.ChatSession, agentID pgtype.UUID, taskContexts ...[]byte) (db.AgentTaskQueue, error) {
	return s.enqueueChatTaskForAgent(ctx, chatSession, agentID, true, taskContexts...)
}

func (s *TaskService) enqueueChatTaskForAgent(ctx context.Context, chatSession db.ChatSession, agentID pgtype.UUID, forceFreshSession bool, taskContexts ...[]byte) (db.AgentTaskQueue, error) {
	agent, err := s.Queries.GetAgent(ctx, agentID)
	if err != nil {
		slog.Error("chat task enqueue failed", "chat_session_id", util.UUIDToString(chatSession.ID), "error", err)
		return db.AgentTaskQueue{}, fmt.Errorf("load agent: %w", err)
	}
	if agent.ArchivedAt.Valid {
		return db.AgentTaskQueue{}, fmt.Errorf("agent is archived")
	}
	if !agent.RuntimeID.Valid {
		return db.AgentTaskQueue{}, fmt.Errorf("agent has no runtime")
	}
	rt, err := s.Queries.GetAgentRuntime(ctx, agent.RuntimeID)
	if err != nil {
		slog.Error("chat task enqueue failed", "chat_session_id", util.UUIDToString(chatSession.ID), "agent_id", util.UUIDToString(agentID), "error", err)
		return db.AgentTaskQueue{}, fmt.Errorf("load runtime: %w", err)
	}
	apiRuntime := runtimeconfig.IsAPIRuntimeMetadata(rt.Metadata)
	if !apiRuntime {
		if err := runtimeCanQueueDaemonTask(rt); err != nil {
			slog.Error("chat task enqueue failed", "chat_session_id", util.UUIDToString(chatSession.ID), "agent_id", util.UUIDToString(agentID), "error", err)
			return db.AgentTaskQueue{}, err
		}
	}
	if apiRuntime {
		cfg, ok := runtimeconfig.LoadAPIRuntimeConfigFromSources(os.Getenv)
		if !ok || cfg.Status() != "online" {
			err := fmt.Errorf("API runtime is not online; configure Model API settings or set %s and %s", runtimeconfig.EnvAPIKey, runtimeconfig.EnvModelName)
			slog.Error("chat task enqueue failed", "chat_session_id", util.UUIDToString(chatSession.ID), "agent_id", util.UUIDToString(agentID), "error", err)
			return db.AgentTaskQueue{}, err
		}
	}

	var taskContext []byte
	if len(taskContexts) > 0 && len(taskContexts[0]) > 0 {
		taskContext = taskContexts[0]
	}
	task, err := s.Queries.CreateChatTask(ctx, db.CreateChatTaskParams{
		AgentID:           agentID,
		RuntimeID:         agent.RuntimeID,
		Priority:          2, // medium priority for chat
		ChatSessionID:     chatSession.ID,
		Context:           taskContext,
		ForceFreshSession: pgtype.Bool{Bool: forceFreshSession, Valid: forceFreshSession},
	})
	if err != nil {
		slog.Error("chat task enqueue failed", "chat_session_id", util.UUIDToString(chatSession.ID), "error", err)
		return db.AgentTaskQueue{}, fmt.Errorf("create chat task: %w", err)
	}

	slog.Info("chat task enqueued",
		"task_id", util.UUIDToString(task.ID),
		"chat_session_id", util.UUIDToString(chatSession.ID),
		"agent_id", util.UUIDToString(agentID),
		"team_session", chatSession.TeamID.Valid,
		"force_fresh_session", forceFreshSession,
	)
	// See EnqueueTaskForIssue for ordering rationale.
	s.broadcastTaskEvent(ctx, protocol.EventTaskQueued, task)
	if apiRuntime {
		s.runAPIRuntimeChatTasksAsync(agentID)
	} else {
		s.notifyTaskAvailable(task)
	}
	return task, nil
}

func (s *TaskService) runAPIRuntimeChatTasksAsync(agentID pgtype.UUID) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), apiRuntimeChatTaskTimeout)
		defer cancel()
		if err := s.runQueuedAPIRuntimeChatTasks(ctx, agentID); err != nil {
			slog.Warn("API runtime chat executor stopped", "agent_id", util.UUIDToString(agentID), "error", err)
		}
	}()
}

func (s *TaskService) runQueuedAPIRuntimeChatTasks(ctx context.Context, agentID pgtype.UUID) error {
	for {
		task, err := s.ClaimTask(ctx, agentID)
		if err != nil {
			return err
		}
		if task == nil {
			return nil
		}
		if err := s.runClaimedAPIRuntimeChatTask(ctx, *task); err != nil {
			slog.Warn("API runtime chat task failed", "task_id", util.UUIDToString(task.ID), "error", err)
		}
	}
}

func (s *TaskService) runClaimedAPIRuntimeChatTask(ctx context.Context, task db.AgentTaskQueue) error {
	runningTask, err := s.StartTask(ctx, task.ID)
	if err != nil {
		return err
	}
	task = *runningTask

	fail := func(message string) error {
		_, failErr := s.FailTask(ctx, task.ID, message, "", "", "api_runtime_error")
		if failErr != nil {
			return fmt.Errorf("%s; fail task: %w", message, failErr)
		}
		return errors.New(message)
	}

	if !task.ChatSessionID.Valid {
		return fail("API runtime only supports chat tasks")
	}

	rt, err := s.Queries.GetAgentRuntime(ctx, task.RuntimeID)
	if err != nil {
		return fail("failed to load API runtime")
	}
	if !runtimeconfig.IsAPIRuntimeMetadata(rt.Metadata) {
		return fail("claimed task does not belong to an API runtime")
	}

	cfg, ok := runtimeconfig.LoadAPIRuntimeConfigFromSources(os.Getenv)
	if !ok || cfg.Status() != "online" {
		return fail("API runtime is not configured; configure Model API settings or set ORIGIN_MODEL_API_KEY and ORIGIN_MODEL_NAME")
	}

	agent, err := s.Queries.GetAgent(ctx, task.AgentID)
	if err != nil {
		return fail("failed to load agent for API runtime task")
	}
	model := apiRuntimeModelForAgent(agent, cfg)
	messages, err := s.buildAPIRuntimeChatMessages(ctx, task, agent)
	if err != nil {
		return fail(err.Error())
	}

	toolExecutor, err := s.apiRuntimeToolExecutor()
	if err != nil {
		return fail(err.Error())
	}

	chatClient := s.apiRuntimeChatClient(cfg)
	workspaceID := s.ResolveTaskWorkspaceID(ctx, task)

	var res modelapi.ChatResult
	if apiRuntimeStreamEnabled() {
		res, err = s.runAPIRuntimeChatLoopStream(ctx, chatClient, toolExecutor, model, messages, task, workspaceID)
	} else {
		res, err = runAPIRuntimeChatLoop(ctx, chatClient, toolExecutor, model, messages)
	}
	if err != nil {
		return fail(err.Error())
	}

	if res.InputTokens > 0 || res.OutputTokens > 0 || res.CacheReadTokens > 0 || res.CacheWriteTokens > 0 {
		if err := s.Queries.UpsertTaskUsage(ctx, db.UpsertTaskUsageParams{
			TaskID:           task.ID,
			Provider:         cfg.Provider,
			Model:            model,
			InputTokens:      res.InputTokens,
			OutputTokens:     res.OutputTokens,
			CacheReadTokens:  res.CacheReadTokens,
			CacheWriteTokens: res.CacheWriteTokens,
		}); err != nil {
			slog.Warn("failed to record API runtime usage", "task_id", util.UUIDToString(task.ID), "error", err)
		}
	}

	result, _ := json.Marshal(protocol.TaskCompletedPayload{
		TaskID: util.UUIDToString(task.ID),
		Output: res.Content,
	})
	if _, err := s.CompleteTask(ctx, task.ID, result, "", ""); err != nil {
		return err
	}
	return nil
}

// apiRuntimeStreamEnabled 读取环境变量 ORIGIN_MODELAPI_STREAM_ENABLED。
// 默认为 true；显式设置为 "false" 时回退到非流式调用。
func apiRuntimeStreamEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("ORIGIN_MODELAPI_STREAM_ENABLED")))
	return v != "false"
}

// runAPIRuntimeChatLoopStream 是流式版本的 chat loop。
// 第一轮调用 ChatStream，将每个 delta 通过 task:message_chunk 事件实时推送到总线；
// 如果模型请求 tool calls（不支持流式中途决策），对该轮 fallback 到 Chat；
// 最后一轮完成后推送 task:message_complete 事件（但不写 DB——由 CompleteTask 路径写）。
func (s *TaskService) runAPIRuntimeChatLoopStream(
	ctx context.Context,
	client apiRuntimeChatClient,
	toolExecutor apiRuntimeToolExecutor,
	model string,
	messages []modelapi.Message,
	task db.AgentTaskQueue,
	workspaceID string,
) (modelapi.ChatResult, error) {
	var total modelapi.ChatResult
	tools := []modelapi.Tool(nil)
	if toolExecutor != nil {
		tools = toolExecutor.Tools()
	}

	// 为本次 assistant 回复预先生成 message_id，所有 chunk/complete 共享
	messageID := uuid.New().String()
	chatSessionID := util.UUIDToString(task.ChatSessionID)
	taskID := util.UUIDToString(task.ID)

	for round := 0; round < apiRuntimeMaxToolRounds; round++ {
		// 只有最后一轮（无 tool 调用或 tool 调用完毕后的最终回复）才走流式
		// tool call 本身走非流式（中途需要整 JSON tool_calls 结构才能执行）
		isLastTextRound := toolExecutor == nil || len(tools) == 0

		var res modelapi.ChatResult
		var err error

		if isLastTextRound || round > 0 {
			// 尝试流式；如果这轮最终触发了 tool calls 则 fallback 到非流式重试
			res, err = client.ChatStream(ctx, modelapi.ChatRequest{
				Model:    model,
				Messages: messages,
				Tools:    tools,
			}, func(chunk string) error {
				if workspaceID == "" || chunk == "" {
					return nil
				}
				s.Bus.Publish(events.Event{
					Type:          protocol.EventTaskMessageChunk,
					WorkspaceID:   workspaceID,
					ActorType:     "system",
					ChatSessionID: chatSessionID,
					TaskID:        taskID,
					Payload: protocol.TaskMessageChunkPayload{
						TaskID:        taskID,
						ChatSessionID: chatSessionID,
						MessageID:     messageID,
						Chunk:         chunk,
					},
				})
				return nil
			})
		} else {
			// 有 tool 配置且第一轮：先用非流式以便获取完整 tool_calls JSON
			res, err = client.Chat(ctx, modelapi.ChatRequest{
				Model:    model,
				Messages: messages,
				Tools:    tools,
			})
		}

		if err != nil {
			return total, err
		}
		accumulateAPIRuntimeUsage(&total, res)

		if len(res.ToolCalls) == 0 {
			// 最终文本回复
			total.Content = res.Content

			// 推 complete 事件（不写 DB，CompleteTask 路径统一写）
			if workspaceID != "" {
				s.Bus.Publish(events.Event{
					Type:          protocol.EventTaskMessageComplete,
					WorkspaceID:   workspaceID,
					ActorType:     "system",
					ChatSessionID: chatSessionID,
					TaskID:        taskID,
					Payload: protocol.TaskMessageCompletePayload{
						TaskID:        taskID,
						ChatSessionID: chatSessionID,
						MessageID:     messageID,
						Content:       res.Content,
						InputTokens:   total.InputTokens,
						OutputTokens:  total.OutputTokens,
					},
				})
			}
			return total, nil
		}

		// 有 tool calls：执行 tool 后追加消息，继续下一轮
		if toolExecutor == nil || len(tools) == 0 {
			return total, fmt.Errorf("model requested tool calls, but API runtime tools are not configured")
		}
		messages = append(messages, modelapi.Message{
			Role:      "assistant",
			Content:   res.Content,
			ToolCalls: res.ToolCalls,
		})
		for _, call := range res.ToolCalls {
			output, err := toolExecutor.Execute(ctx, call)
			if err != nil {
				output = apiRuntimeToolErrorJSON(call.Function.Name, err)
			}
			messages = append(messages, modelapi.Message{
				Role:       "tool",
				ToolCallID: call.ID,
				Content:    output,
			})
		}
		// 重置 messageID 以区分 tool 执行后最终回复的 chunk 序列
		messageID = uuid.New().String()
	}

	return total, fmt.Errorf("API runtime exceeded %d tool-call rounds", apiRuntimeMaxToolRounds)
}

func (s *TaskService) apiRuntimeChatClient(cfg runtimeconfig.APIRuntimeConfig) apiRuntimeChatClient {
	if s.APIChatClientFactory != nil {
		return s.APIChatClientFactory(cfg)
	}
	return modelapi.NewClient(cfg.APIKey, cfg.BaseURL, nil)
}

func (s *TaskService) apiRuntimeToolExecutor() (apiRuntimeToolExecutor, error) {
	if s.APIToolExecutor != nil {
		return s.APIToolExecutor, nil
	}
	return apitools.NewLocalExecutor(apitools.ConfigFromEnv())
}

func runAPIRuntimeChatLoop(ctx context.Context, client apiRuntimeChatClient, toolExecutor apiRuntimeToolExecutor, model string, messages []modelapi.Message) (modelapi.ChatResult, error) {
	var total modelapi.ChatResult
	tools := []modelapi.Tool(nil)
	if toolExecutor != nil {
		tools = toolExecutor.Tools()
	}

	for round := 0; round < apiRuntimeMaxToolRounds; round++ {
		res, err := client.Chat(ctx, modelapi.ChatRequest{
			Model:    model,
			Messages: messages,
			Tools:    tools,
		})
		if err != nil {
			return total, err
		}
		accumulateAPIRuntimeUsage(&total, res)
		if len(res.ToolCalls) == 0 {
			total.Content = res.Content
			return total, nil
		}
		if toolExecutor == nil || len(tools) == 0 {
			return total, fmt.Errorf("model requested tool calls, but API runtime tools are not configured")
		}

		messages = append(messages, modelapi.Message{
			Role:      "assistant",
			Content:   res.Content,
			ToolCalls: res.ToolCalls,
		})
		for _, call := range res.ToolCalls {
			output, err := toolExecutor.Execute(ctx, call)
			if err != nil {
				output = apiRuntimeToolErrorJSON(call.Function.Name, err)
			}
			messages = append(messages, modelapi.Message{
				Role:       "tool",
				ToolCallID: call.ID,
				Content:    output,
			})
		}
	}

	return total, fmt.Errorf("API runtime exceeded %d tool-call rounds", apiRuntimeMaxToolRounds)
}

func accumulateAPIRuntimeUsage(total *modelapi.ChatResult, res modelapi.ChatResult) {
	total.InputTokens += res.InputTokens
	total.OutputTokens += res.OutputTokens
	total.CacheReadTokens += res.CacheReadTokens
	total.CacheWriteTokens += res.CacheWriteTokens
}

func apiRuntimeToolErrorJSON(name string, err error) string {
	raw, marshalErr := json.Marshal(map[string]string{
		"tool":  name,
		"error": err.Error(),
	})
	if marshalErr != nil {
		return fmt.Sprintf(`{"tool":%q,"error":%q}`, name, err.Error())
	}
	return string(raw)
}

func apiRuntimeModelForAgent(agent db.Agent, cfg runtimeconfig.APIRuntimeConfig) string {
	if agent.Model.Valid {
		if model := strings.TrimSpace(agent.Model.String); model != "" {
			return model
		}
	}
	return cfg.DefaultModel
}

func (s *TaskService) buildAPIRuntimeChatMessages(ctx context.Context, task db.AgentTaskQueue, agent db.Agent) ([]modelapi.Message, error) {
	if !task.ChatSessionID.Valid {
		return nil, fmt.Errorf("chat session is required")
	}

	var messages []modelapi.Message
	systemPrompt := s.buildAPIRuntimeSystemPrompt(ctx, task, agent)
	if systemPrompt != "" {
		messages = append(messages, modelapi.Message{Role: "system", Content: systemPrompt})
	}

	history, err := s.Queries.ListChatMessages(ctx, task.ChatSessionID)
	if err != nil {
		return nil, fmt.Errorf("load chat history: %w", err)
	}
	for _, msg := range history {
		role := msg.Role
		if role != "user" && role != "assistant" && role != "system" {
			continue
		}
		content := strings.TrimSpace(msg.Content)
		if content == "" {
			continue
		}
		messages = append(messages, modelapi.Message{Role: role, Content: content})
	}
	if len(messages) == 0 || (len(messages) == 1 && messages[0].Role == "system") {
		return nil, fmt.Errorf("chat history has no user message")
	}
	return messages, nil
}

func (s *TaskService) buildAPIRuntimeSystemPrompt(ctx context.Context, task db.AgentTaskQueue, agent db.Agent) string {
	var parts []string
	if instructions := strings.TrimSpace(agent.Instructions); instructions != "" {
		parts = append(parts, instructions)
	}

	skills, requestedNames := s.LoadAgentSkillsForTask(ctx, agent.ID, agent.WorkspaceID, task.Context)
	if len(skills) > 0 {
		var b strings.Builder
		b.WriteString("Agent skills available as reference material:")
		for _, skill := range skills {
			b.WriteString("\n\n# ")
			b.WriteString(skill.Name)
			if skill.Content != "" {
				b.WriteString("\n")
				b.WriteString(skill.Content)
			}
			for _, file := range skill.Files {
				b.WriteString("\n\n## ")
				b.WriteString(file.Path)
				b.WriteString("\n")
				b.WriteString(file.Content)
			}
		}
		if len(requestedNames) > 0 {
			b.WriteString("\n\nThe user explicitly invoked: ")
			b.WriteString(strings.Join(requestedNames, ", "))
		}
		parts = append(parts, b.String())
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

// CancelTasksForIssue cancels every active task on the issue, reconciles each
// affected agent's status, and broadcasts task:cancelled events so frontends
// clear their live cards.
//
// Before #1587 this path was "cancel rows and return" — issue-status flips
// (e.g. user marks the issue `done` or `cancelled` while a task is still
// running) left the agent stuck at status="working" indefinitely, requiring a
// manual `multica agent update <id> --status idle` to unwedge. Matches the
// pattern already used by CancelTask and RerunIssue.
func (s *TaskService) CancelTasksForIssue(ctx context.Context, issueID pgtype.UUID) error {
	cancelled, err := s.Queries.CancelAgentTasksByIssue(ctx, issueID)
	if err != nil {
		return err
	}
	for _, t := range cancelled {
		s.ReconcileAgentStatus(ctx, t.AgentID)
		s.broadcastTaskEvent(ctx, protocol.EventTaskCancelled, t)
	}
	return nil
}

// CancelTasksForAgent cancels every active task belonging to an agent
// (queued + dispatched + running), reconciles the agent's status, and
// broadcasts task:cancelled events. Used by the agent-level "Cancel all
// tasks" action — same shape as CancelTasksForIssue but scoped on agent_id.
//
// Returns the cancelled rows so callers can report counts / log them.
func (s *TaskService) CancelTasksForAgent(ctx context.Context, agentID pgtype.UUID) ([]db.AgentTaskQueue, error) {
	cancelled, err := s.Queries.CancelAgentTasksByAgent(ctx, agentID)
	if err != nil {
		return nil, err
	}
	for _, t := range cancelled {
		s.broadcastTaskEvent(ctx, protocol.EventTaskCancelled, t)
	}
	// Reconcile once after the loop — agent transitions from
	// working→available based on remaining task counts, no need to call
	// per row (the rows we just cancelled all belong to the same agent).
	s.ReconcileAgentStatus(ctx, agentID)
	return cancelled, nil
}

// CancelTasksByTriggerComment cancels active tasks whose trigger is the given
// comment. Called from DeleteComment so an agent does not run with the
// now-deleted content already embedded in its prompt. Must be invoked BEFORE
// the comment row is deleted because the FK ON DELETE SET NULL would
// otherwise nullify trigger_comment_id and we'd lose the ability to find
// the affected tasks.
func (s *TaskService) CancelTasksByTriggerComment(ctx context.Context, commentID pgtype.UUID) error {
	cancelled, err := s.Queries.CancelAgentTasksByTriggerComment(ctx, commentID)
	if err != nil {
		return err
	}
	for _, t := range cancelled {
		s.ReconcileAgentStatus(ctx, t.AgentID)
		s.broadcastTaskEvent(ctx, protocol.EventTaskCancelled, t)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Council relay lifecycle — 串行 relay 链的中止信号穿透
// ---------------------------------------------------------------------------

// councilRelayHandle 是一次 council @全体 relay 链的中止句柄。串行 relay 由
// CompleteTask 路径的 handleCouncilBroadcastRelay 逐轮推进，跨越多次异步
// 回调，所以中止信号不能挂在单次请求的 ctx 上，必须存进进程级 map，由
// Adjourn / 单任务取消路径显式触发。
type councilRelayHandle struct {
	cancel        context.CancelFunc
	canceled      atomic.Bool
	generation    int64  // 链代数：同一 sessionKey 每次注册递增，旧链靠它感知被取代
	sessionID     string // 原始 council / team UUID，事件 payload 用它
	workspaceID   string
	chatSessionID string
}

// councilCancels 持有所有 running relay 链的句柄，key 是
// broadcastRelayKey(sourceKind, sessionID)。同一 key 只保留最新注册的链。
var councilCancels sync.Map

// relayGenerationCounter 给每条 relay 链分配递增代数。重复 @全体 时新链
// 会覆盖 map 里的旧句柄，旧链在下一轮推进前比较代数发现自己已被取代，
// 从而停止 enqueue——否则两条链会并发轮转、发言互相交错。
var relayGenerationCounter atomic.Int64

// ctxRelayHandleKey 是 ctx 里携带当前链句柄的 key，enqueue 时把代数写进
// task payload 供 handleCouncilBroadcastRelay 比对。
type ctxRelayHandleKey struct{}

func relayHandleFromCtx(ctx context.Context) *councilRelayHandle {
	if h, ok := ctx.Value(ctxRelayHandleKey{}).(*councilRelayHandle); ok {
		return h
	}
	return nil
}

// RegisterCouncilSession 注册一个 council / team 会话的 relay 链并返回带
// 取消的 ctx，ctx 里同时携带链句柄。同一 sessionKey 重复注册时先取消旧句柄
// 并用新句柄覆盖——例如用户在 relay 进行中又发了一条 @全体，旧链立即视为
// 已中止。
func (s *TaskService) RegisterCouncilSession(sourceKind, sessionID, chatSessionID, workspaceID string) context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	sessionKey := broadcastRelayKey(sourceKind, sessionID)
	handle := &councilRelayHandle{
		cancel:        cancel,
		sessionID:     sessionID,
		workspaceID:   workspaceID,
		chatSessionID: chatSessionID,
		generation:    relayGenerationCounter.Add(1),
	}
	if old, loaded := councilCancels.Load(sessionKey); loaded {
		oldH := old.(*councilRelayHandle)
		oldH.canceled.Store(true)
		oldH.cancel()
	}
	councilCancels.Store(sessionKey, handle)
	return context.WithValue(ctx, ctxRelayHandleKey{}, handle)
}

// CancelCouncilSession 中止一个 relay 链：标记 canceled 并触发 cancel，同时
// 推送 council:relay_cancelled 事件，最后移除句柄。已中止的链在
// handleCouncilBroadcastRelay 里通过「句柄不存在即视为中止」的语义不再
// enqueue 下一轮。对不存在的 sessionKey 是幂等 no-op。
func (s *TaskService) CancelCouncilSession(sessionKey string) {
	v, ok := councilCancels.Load(sessionKey)
	if !ok {
		return
	}
	h := v.(*councilRelayHandle)
	h.canceled.Store(true)
	h.cancel()
	slog.Info("council relay cancelled",
		"session_key", sessionKey,
		"chat_session_id", h.chatSessionID)
	if h.workspaceID != "" {
		s.Bus.Publish(events.Event{
			Type:          protocol.EventCouncilRelayCancelled,
			WorkspaceID:   h.workspaceID,
			ActorType:     "system",
			ActorID:       "",
			ChatSessionID: h.chatSessionID,
			Payload: protocol.CouncilRelayPayload{
				CouncilSessionID: h.sessionID,
				ChatSessionID:    h.chatSessionID,
			},
		})
	}
	councilCancels.Delete(sessionKey)
}

// CancelCouncilRelay 中止指定 sourceKind + sessionID 的 relay 链。handler 层
// 中止 council 会话时用它穿透到进行中的链上。
func (s *TaskService) CancelCouncilRelay(sourceKind, sessionID string) {
	s.CancelCouncilSession(broadcastRelayKey(sourceKind, sessionID))
}

// deregisterCouncilSession 移除 relay 链句柄。链自然结束（follower 收尾 /
// salon 到 MaxTurns / 无 follower 可接）时调用，避免 sync.Map 泄漏。
func (s *TaskService) deregisterCouncilSession(sessionKey string) {
	councilCancels.Delete(sessionKey)
}

// councilRelayCanceled 返回 relay 链是否应该停止推进。句柄不存在（从未
// 注册 / 已自然结束 deregister / 已被取消后删除）一律视为中止；generation
// 与当前句柄不一致说明本链已被后续注册取代。取消路径和自然结束路径都会
// 移除句柄，handleCouncilBroadcastRelay 在下一轮 enqueue 前用这个语义兜底，
// 避免取消后仍有多余轮次。
func (s *TaskService) councilRelayCanceled(sessionKey string, generation int64) bool {
	v, ok := councilCancels.Load(sessionKey)
	if !ok {
		return true
	}
	h := v.(*councilRelayHandle)
	if generation != 0 && h.generation != generation {
		return true
	}
	return h.canceled.Load()
}

// CancelCouncilRelayForTask 若 task 是 council broadcast 链上的一环，穿透
// 取消整条 relay 链。供单任务取消路径（CancelTask / CancelTaskByUser）调用：
// 用户取消某个 agent 的发言任务时，后续轮不再 enqueue。
func (s *TaskService) CancelCouncilRelayForTask(task db.AgentTaskQueue) {
	if len(task.Context) == 0 {
		return
	}
	var bc CouncilBroadcastContext
	if json.Unmarshal(task.Context, &bc) != nil || bc.Type != CouncilBroadcastContextType {
		return
	}
	s.CancelCouncilSession(broadcastRelayKey(bc.SourceKind, bc.CouncilSessionID))
}

// CancelTask cancels a single task by ID. It broadcasts a task:cancelled event
// so frontends can update immediately.
func (s *TaskService) CancelTask(ctx context.Context, taskID pgtype.UUID) (*db.AgentTaskQueue, error) {
	task, err := s.Queries.CancelAgentTask(ctx, taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, err := s.Queries.GetAgentTask(ctx, taskID)
		if err != nil {
			return nil, fmt.Errorf("cancel task: %w", err)
		}
		return &existing, nil
	}
	if err != nil {
		return nil, fmt.Errorf("cancel task: %w", err)
	}

	slog.Info("task cancelled", "task_id", util.UUIDToString(task.ID), "issue_id", util.UUIDToString(task.IssueID))

	// Reconcile agent status
	s.ReconcileAgentStatus(ctx, task.AgentID)

	// Broadcast cancellation as a task:failed event so frontends clear the live card
	s.broadcastTaskEvent(ctx, protocol.EventTaskCancelled, task)

	// 若被取消的 task 是 council @全体 relay 链上的一环，穿透中止整条链——
	// 用户取消某个 agent 的发言时，后续轮不再 enqueue。
	s.CancelCouncilRelayForTask(task)

	return &task, nil
}

// ClaimTask atomically claims the next queued task for an agent,
// respecting max_concurrent_tasks.
func (s *TaskService) ClaimTask(ctx context.Context, agentID pgtype.UUID) (*db.AgentTaskQueue, error) {
	start := time.Now()
	var (
		outcome                                                              = "unknown"
		getAgentMs, countRunningMs, claimAgentMs, updateStatusMs, dispatchMs int64
	)
	defer func() {
		s.maybeLogClaimSlow(agentID, outcome, start, getAgentMs, countRunningMs, claimAgentMs, updateStatusMs, dispatchMs)
	}()

	t0 := start
	agent, err := s.Queries.GetAgent(ctx, agentID)
	getAgentMs = time.Since(t0).Milliseconds()
	if err != nil {
		outcome = "error_get_agent"
		return nil, fmt.Errorf("agent not found: %w", err)
	}

	t0 = time.Now()
	running, err := s.Queries.CountRunningTasks(ctx, agentID)
	countRunningMs = time.Since(t0).Milliseconds()
	if err != nil {
		outcome = "error_count_running"
		return nil, fmt.Errorf("count running tasks: %w", err)
	}
	if running >= int64(agent.MaxConcurrentTasks) {
		slog.Debug("task claim: no capacity", "agent_id", util.UUIDToString(agentID), "running", running, "max", agent.MaxConcurrentTasks)
		outcome = "no_capacity"
		return nil, nil // No capacity
	}

	t0 = time.Now()
	task, err := s.Queries.ClaimAgentTask(ctx, agentID)
	claimAgentMs = time.Since(t0).Milliseconds()
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.Debug("task claim: no tasks available", "agent_id", util.UUIDToString(agentID))
			outcome = "no_tasks"
			return nil, nil // No tasks available
		}
		outcome = "error_claim"
		return nil, fmt.Errorf("claim task: %w", err)
	}

	slog.Info("task claimed", "task_id", util.UUIDToString(task.ID), "agent_id", util.UUIDToString(agentID))

	// Refresh agent status from active tasks. This avoids a stale unconditional
	// working write racing after a just-cancelled claim.
	t0 = time.Now()
	s.ReconcileAgentStatus(ctx, agentID)
	updateStatusMs = time.Since(t0).Milliseconds()

	// Broadcast task:dispatch. ResolveTaskWorkspaceID inside this path can
	// re-query issue/chat_session/autopilot_run, so it can also be a real
	// contributor to claim latency.
	t0 = time.Now()
	s.broadcastTaskDispatch(ctx, task)
	dispatchMs = time.Since(t0).Milliseconds()

	outcome = "claimed"
	return &task, nil
}

// ClaimTaskForRuntime claims the next runnable task for a runtime while
// still respecting each agent's max_concurrent_tasks limit.
//
// Empty-claim fast path: when EmptyClaim is configured and a recent
// check verified the runtime had no queued tasks, returns immediately
// without touching Postgres. The cache is invalidated synchronously on
// every enqueue (notifyTaskAvailable), so a queued task becomes
// claimable on the next call rather than waiting for the TTL.
func (s *TaskService) ClaimTaskForRuntime(ctx context.Context, runtimeID pgtype.UUID) (*db.AgentTaskQueue, error) {
	start := time.Now()
	var (
		outcome          = "no_task"
		listMs, loopMs   int64
		listCount, tried int
		claimedFlag      bool
	)
	defer func() {
		totalMs := time.Since(start).Milliseconds()
		if totalMs < 300 {
			return
		}
		slog.Info("claim_for_runtime slow",
			"runtime_id", util.UUIDToString(runtimeID),
			"outcome", outcome,
			"total_ms", totalMs,
			"list_pending_ms", listMs,
			"list_pending_count", listCount,
			"agents_tried", tried,
			"claim_loop_ms", loopMs,
			"claimed", claimedFlag,
		)
	}()

	runtimeKey := util.UUIDToString(runtimeID)
	if s.EmptyClaim.IsEmpty(ctx, runtimeKey) {
		outcome = "empty_cache_hit"
		return nil, nil
	}

	// Sample the invalidation version BEFORE the SELECT. If a
	// concurrent enqueue Bumps between this read and the post-SELECT
	// MarkEmpty, the next IsEmpty will see the empty key tagged with
	// a stale version and reject it — closing the race that would
	// otherwise stall the just-queued task until the empty key's TTL
	// expired.
	preSelectVersion := s.EmptyClaim.CurrentVersion(ctx, runtimeKey)

	t0 := time.Now()
	tasks, err := s.Queries.ListQueuedClaimCandidatesByRuntime(ctx, runtimeID)
	listMs = time.Since(t0).Milliseconds()
	listCount = len(tasks)
	if err != nil {
		outcome = "error_list"
		return nil, fmt.Errorf("list queued claim candidates: %w", err)
	}

	if len(tasks) == 0 {
		s.EmptyClaim.MarkEmpty(ctx, runtimeKey, preSelectVersion)
		outcome = "empty_db"
		return nil, nil
	}

	loopStart := time.Now()
	triedAgents := map[string]struct{}{}
	var claimed *db.AgentTaskQueue
	for _, candidate := range tasks {
		agentKey := util.UUIDToString(candidate.AgentID)
		if _, seen := triedAgents[agentKey]; seen {
			continue
		}
		triedAgents[agentKey] = struct{}{}
		tried++

		task, err := s.ClaimTask(ctx, candidate.AgentID)
		if err != nil {
			loopMs = time.Since(loopStart).Milliseconds()
			outcome = "error_claim"
			return nil, err
		}
		if task != nil && task.RuntimeID == runtimeID {
			claimed = task
			break
		}
	}
	loopMs = time.Since(loopStart).Milliseconds()
	if claimed != nil {
		claimedFlag = true
		outcome = "claimed"
	}

	return claimed, nil
}

// maybeLogClaimSlow emits one structured log per ClaimTask call when its total
// latency exceeds 300ms, so the prod tail can be diagnosed without flooding
// logs at normal poll rates. Called via defer so it captures the full path
// including post-claim updateAgentStatus / broadcastTaskDispatch (both of
// which can hit the DB) and any error exit.
func (s *TaskService) maybeLogClaimSlow(agentID pgtype.UUID, outcome string, start time.Time, getAgentMs, countRunningMs, claimAgentMs, updateStatusMs, dispatchMs int64) {
	totalMs := time.Since(start).Milliseconds()
	if totalMs < 300 {
		return
	}
	slog.Info("claim_task slow",
		"agent_id", util.UUIDToString(agentID),
		"outcome", outcome,
		"total_ms", totalMs,
		"get_agent_ms", getAgentMs,
		"count_running_ms", countRunningMs,
		"claim_agent_ms", claimAgentMs,
		"update_status_ms", updateStatusMs,
		"dispatch_ms", dispatchMs,
	)
}

// StartTask transitions a dispatched task to running.
// Issue status is NOT changed here — the agent manages it via the CLI.
func (s *TaskService) StartTask(ctx context.Context, taskID pgtype.UUID) (*db.AgentTaskQueue, error) {
	task, err := s.Queries.StartAgentTask(ctx, taskID)
	if err != nil {
		return nil, fmt.Errorf("start task: %w", err)
	}

	slog.Info("task started", "task_id", util.UUIDToString(task.ID), "issue_id", util.UUIDToString(task.IssueID))
	return &task, nil
}

// CompleteTask marks a task as completed.
// Issue status is NOT changed here — the agent manages it via the CLI.
//
// For chat tasks, CompleteAgentTask and the chat_session resume-pointer
// update run in a single transaction. This closes a race where the next
// queued chat message could be claimed in the window between the task
// flipping to 'completed' and chat_session.session_id being refreshed,
// causing the new task to resume against a stale (or NULL) session.
func (s *TaskService) CompleteTask(ctx context.Context, taskID pgtype.UUID, result []byte, sessionID, workDir string) (*db.AgentTaskQueue, error) {
	var task db.AgentTaskQueue
	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		t, err := qtx.CompleteAgentTask(ctx, db.CompleteAgentTaskParams{
			ID:        taskID,
			Result:    result,
			SessionID: pgtype.Text{String: sessionID, Valid: sessionID != ""},
			WorkDir:   pgtype.Text{String: workDir, Valid: workDir != ""},
		})
		if err != nil {
			return err
		}
		task = t

		if t.ChatSessionID.Valid {
			// COALESCE in SQL guarantees empty inputs don't wipe the
			// existing resume pointer; we still surface DB errors.
			if err := qtx.UpdateChatSessionSession(ctx, db.UpdateChatSessionSessionParams{
				ID:        t.ChatSessionID,
				SessionID: pgtype.Text{String: sessionID, Valid: sessionID != ""},
				WorkDir:   pgtype.Text{String: workDir, Valid: workDir != ""},
			}); err != nil {
				return fmt.Errorf("update chat session resume pointer: %w", err)
			}
		}
		return nil
	}); err != nil {
		// When parallel agents race, a task may already be completed,
		// cancelled, or failed by the time this call runs. The UPDATE
		// … WHERE status = 'running' returns no rows in that case.
		// Treat it as an idempotent success — same pattern as CancelTask.
		if existing, lookupErr := s.Queries.GetAgentTask(ctx, taskID); lookupErr == nil {
			if errors.Is(err, pgx.ErrNoRows) {
				slog.Info("complete task: already finalized",
					"task_id", util.UUIDToString(taskID),
					"current_status", existing.Status,
					"agent_id", util.UUIDToString(existing.AgentID),
				)
				return &existing, nil
			}
			slog.Warn("complete task failed",
				"task_id", util.UUIDToString(taskID),
				"current_status", existing.Status,
				"issue_id", util.UUIDToString(existing.IssueID),
				"chat_session_id", util.UUIDToString(existing.ChatSessionID),
				"agent_id", util.UUIDToString(existing.AgentID),
				"error", err,
			)
		} else {
			slog.Warn("complete task failed: task not found",
				"task_id", util.UUIDToString(taskID),
				"lookup_error", lookupErr,
			)
		}
		return nil, fmt.Errorf("complete task: %w", err)
	}

	slog.Info("task completed", "task_id", util.UUIDToString(task.ID), "issue_id", util.UUIDToString(task.IssueID))

	// Invariant: every completed issue task must have at least one agent
	// comment on the issue, so the user always sees something when a run
	// ends. If the agent posted a comment during execution (result, progress
	// ping, or CLI reply), HasAgentCommentedSince returns true and we skip.
	// Otherwise, synthesize one from the final output. For comment-triggered
	// tasks, TriggerCommentID threads the fallback under the original comment;
	// for assignment-triggered tasks it is NULL and the fallback is top-level.
	// Chat tasks have no IssueID and are handled separately below.
	if task.IssueID.Valid {
		agentCommented, _ := s.Queries.HasAgentCommentedSince(ctx, db.HasAgentCommentedSinceParams{
			IssueID:  task.IssueID,
			AuthorID: task.AgentID,
			Since:    task.StartedAt,
		})
		if !agentCommented {
			var payload protocol.TaskCompletedPayload
			if err := json.Unmarshal(result, &payload); err == nil {
				if payload.Output != "" {
					// Match the CLI's --content / --description behavior: agents that
					// emit literal `\n` 4-char sequences (Python/JSON-style) get them
					// decoded into real newlines before the comment hits the DB. See
					// util.UnescapeBackslashEscapes for the exact contract.
					body := util.UnescapeBackslashEscapes(payload.Output)
					s.createAgentComment(ctx, task.IssueID, task.AgentID, redact.Text(body), "comment", task.TriggerCommentID)
				}
			}
		}
	}

	// Quick-create tasks: locate the issue the agent just created and push
	// an inbox confirmation to the requester. The agent has no issue / chat
	// link, so the regular completion paths above don't apply. We find the
	// new issue by querying for the most recent issue this agent created in
	// the requester's workspace since the task started — more robust than
	// parsing the agent's stdout for an identifier.
	if qc, ok := s.parseQuickCreateContext(task); ok {
		s.notifyQuickCreateCompleted(ctx, task, qc)
	}

	// For chat tasks, save assistant reply and broadcast chat:done. The
	// resume pointer was already persisted inside the transaction above.
	if task.ChatSessionID.Valid {
		var payload protocol.TaskCompletedPayload
		if err := json.Unmarshal(result, &payload); err == nil && payload.Output != "" {
			// Same unescape as the issue-comment path above: literal `\n` from
			// agent stdout becomes a real newline so the chat panel renders
			// paragraph breaks instead of one wall of prose.
			body := util.UnescapeBackslashEscapes(payload.Output)
			message, err := s.Queries.CreateChatMessage(ctx, db.CreateChatMessageParams{
				ChatSessionID: task.ChatSessionID,
				Role:          "assistant",
				Content:       sanitizer.Sanitize(redact.Text(body)),
				TaskID:        task.ID,
				ElapsedMs:     computeChatElapsedMs(task),
				// For team sessions the daemon hands us back an assistant reply
				// without knowing it ran inside a group chat — we tag it with
				// the agent that ran the task so the UI can attribute the
				// message in a multi-agent timeline. 1:1 sessions leave this
				// NULL because session.agent_id is already authoritative.
				SenderAgentID: s.senderAgentForChatSession(ctx, task),
			})
			if err != nil {
				slog.Error("failed to save assistant chat message", "task_id", util.UUIDToString(task.ID), "error", err)
			} else {
				// Event-driven unread: stamp unread_since on the first unread
				// assistant message. No-op if the session already has unread.
				// If the user is actively viewing the session, the frontend's
				// auto-mark-read effect will clear this within a tick.
				if err := s.Queries.SetUnreadSinceIfNull(ctx, task.ChatSessionID); err != nil {
					slog.Warn("failed to set unread_since", "chat_session_id", util.UUIDToString(task.ChatSessionID), "error", err)
				}
				s.handleTeamAssistantMessage(ctx, task, message)
				// Council @全体 relay: when the just-finished task is a LEAD
				// broadcast, enqueue the follower. When it's a FOLLOWER
				// broadcast, the relay stops. Anything else → no-op.
				s.handleCouncilBroadcastRelay(ctx, task)
				// 客厅内部 session：agent 回复完成后同步写 room_message + 推 room:message 事件
				s.maybeWriteRoomMessage(ctx, task, message)
			}
		}
		s.broadcastChatDone(ctx, task)
		s.broadcastTeamMessageIfTeamSession(ctx, task)
	}

	s.syncMissionTaskCompleted(ctx, task, result)

	// Reconcile agent status
	s.ReconcileAgentStatus(ctx, task.AgentID)

	// Broadcast
	s.broadcastTaskEvent(ctx, protocol.EventTaskCompleted, task)

	return &task, nil
}

// FailTask marks a task as failed.
// Issue status is NOT changed here — the agent manages it via the CLI.
//
// sessionID/workDir are optional: when the agent established a real session
// before failing (e.g. crashed mid-conversation, was cancelled, or hit a
// tool error), the daemon should pass them so we can preserve the resume
// pointer on both the task row and the chat_session — otherwise the next
// chat turn would silently start a brand-new session and lose memory.
//
// failureReason is a coarse classifier consumed by the auto-retry path.
// Pass "" when unknown (treated as 'agent_error').
func (s *TaskService) FailTask(ctx context.Context, taskID pgtype.UUID, errMsg, sessionID, workDir, failureReason string) (*db.AgentTaskQueue, error) {
	var task db.AgentTaskQueue
	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		t, err := qtx.FailAgentTask(ctx, db.FailAgentTaskParams{
			ID:            taskID,
			Error:         pgtype.Text{String: errMsg, Valid: true},
			FailureReason: pgtype.Text{String: failureReason, Valid: failureReason != ""},
			SessionID:     pgtype.Text{String: sessionID, Valid: sessionID != ""},
			WorkDir:       pgtype.Text{String: workDir, Valid: workDir != ""},
		})
		if err != nil {
			return err
		}
		task = t

		if t.ChatSessionID.Valid {
			if err := qtx.UpdateChatSessionSession(ctx, db.UpdateChatSessionSessionParams{
				ID:        t.ChatSessionID,
				SessionID: pgtype.Text{String: sessionID, Valid: sessionID != ""},
				WorkDir:   pgtype.Text{String: workDir, Valid: workDir != ""},
			}); err != nil {
				return fmt.Errorf("update chat session resume pointer: %w", err)
			}
		}
		return nil
	}); err != nil {
		if existing, lookupErr := s.Queries.GetAgentTask(ctx, taskID); lookupErr == nil {
			if errors.Is(err, pgx.ErrNoRows) {
				slog.Info("fail task: already finalized",
					"task_id", util.UUIDToString(taskID),
					"current_status", existing.Status,
					"agent_id", util.UUIDToString(existing.AgentID),
				)
				return &existing, nil
			}
			slog.Warn("fail task failed",
				"task_id", util.UUIDToString(taskID),
				"current_status", existing.Status,
				"issue_id", util.UUIDToString(existing.IssueID),
				"chat_session_id", util.UUIDToString(existing.ChatSessionID),
				"agent_id", util.UUIDToString(existing.AgentID),
				"error", err,
			)
		} else {
			slog.Warn("fail task failed: task not found",
				"task_id", util.UUIDToString(taskID),
				"lookup_error", lookupErr,
			)
		}
		return nil, fmt.Errorf("fail task: %w", err)
	}

	slog.Warn("task failed", "task_id", util.UUIDToString(task.ID), "issue_id", util.UUIDToString(task.IssueID), "error", errMsg, "failure_reason", failureReason)

	// Auto-retry eligible failures (orphan, timeout, runtime_offline,
	// runtime_recovery). The helper itself enforces attempt < max_attempts
	// and only triggers for issue/chat tasks.
	retried, _ := s.MaybeRetryFailedTask(ctx, task)

	// Skip the per-failure system comment when we'll immediately retry —
	// the new task will surface its own status to the user, and we don't
	// want to spam the issue with "task timed out" messages on every
	// daemon hiccup.
	if errMsg != "" && task.IssueID.Valid && retried == nil {
		s.createAgentComment(ctx, task.IssueID, task.AgentID, redact.Text(errMsg), "system", task.TriggerCommentID)
	}

	// Mirror the issue fallback for chat tasks: write an assistant
	// chat_message tagged with the daemon-reported failure_reason so the
	// conversation history shows what happened. Skip when auto-retry is
	// pending (the new attempt will write its own outcome) — same guard as
	// the issue path above.
	if task.ChatSessionID.Valid && retried == nil {
		if _, err := s.Queries.CreateChatMessage(ctx, db.CreateChatMessageParams{
			ChatSessionID: task.ChatSessionID,
			Role:          "assistant",
			Content:       redact.Text(errMsg),
			TaskID:        pgtype.UUID{Bytes: task.ID.Bytes, Valid: true},
			FailureReason: pgtype.Text{String: failureReason, Valid: failureReason != ""},
			ElapsedMs:     computeChatElapsedMs(task),
			SenderAgentID: s.senderAgentForChatSession(ctx, task),
		}); err != nil {
			slog.Error("failed to save failure chat message",
				"task_id", util.UUIDToString(task.ID),
				"chat_session_id", util.UUIDToString(task.ChatSessionID),
				"error", err)
		} else if err := s.Queries.SetUnreadSinceIfNull(ctx, task.ChatSessionID); err != nil {
			slog.Warn("failed to set unread_since on failure",
				"chat_session_id", util.UUIDToString(task.ChatSessionID),
				"error", err)
		}
		s.broadcastTeamMessageIfTeamSession(ctx, task)
	}

	if retried == nil {
		s.syncMissionTaskFailed(ctx, task, errMsg)
	}

	// Quick-create tasks: push a failure inbox notification to the
	// requester so they can either retry or fall back to the advanced form
	// without losing their original prompt. Skipped when an auto-retry is
	// pending — the new attempt will write its own outcome.
	if retried == nil {
		if qc, ok := s.parseQuickCreateContext(task); ok {
			s.notifyQuickCreateFailed(ctx, task, qc, errMsg)
		}
	}
	// Reconcile agent status
	s.ReconcileAgentStatus(ctx, task.AgentID)

	// Broadcast
	s.broadcastTaskEvent(ctx, protocol.EventTaskFailed, task)

	return &task, nil
}

// retryableReasons enumerates failure reasons that the auto-retry path is
// allowed to act on. Agent-side errors (compile failures, model rejections,
// etc.) are intentionally excluded — those are real problems that the user
// should see, not infrastructure flakiness.
var retryableReasons = map[string]bool{
	"runtime_offline":  true,
	"runtime_recovery": true,
	"timeout":          true,
}

// MaybeRetryFailedTask spawns a fresh queued attempt for a recently-failed
// task when the failure was infrastructure-shaped (daemon crash, runtime
// went offline, dispatch/run timeout) and the task hasn't exhausted its
// max_attempts budget. The child task inherits agent/runtime/issue/chat
// links and the parent's session_id/work_dir so the agent can resume the
// conversation when the backend supports it. Returns the new task, or nil
// when no retry was created.
//
// Autopilot tasks are NOT auto-retried here; the autopilot scheduler owns
// its own re-run cadence and we don't want to double-fire it.
func (s *TaskService) MaybeRetryFailedTask(ctx context.Context, parent db.AgentTaskQueue) (*db.AgentTaskQueue, error) {
	if parent.Status != "failed" {
		return nil, nil
	}
	reason := ""
	if parent.FailureReason.Valid {
		reason = parent.FailureReason.String
	}
	if !retryableReasons[reason] {
		return nil, nil
	}
	if parent.Attempt >= parent.MaxAttempts {
		slog.Info("task auto-retry skipped: budget exhausted",
			"task_id", util.UUIDToString(parent.ID),
			"attempt", parent.Attempt,
			"max_attempts", parent.MaxAttempts,
		)
		return nil, nil
	}
	if parent.AutopilotRunID.Valid {
		// Autopilot has its own retry semantics; do not double-trigger.
		return nil, nil
	}
	if !parent.IssueID.Valid && !parent.ChatSessionID.Valid {
		return nil, nil
	}

	child, err := s.Queries.CreateRetryTask(ctx, parent.ID)
	if err != nil {
		slog.Warn("task auto-retry failed",
			"parent_task_id", util.UUIDToString(parent.ID),
			"reason", reason,
			"error", err,
		)
		return nil, err
	}
	slog.Info("task auto-retry enqueued",
		"parent_task_id", util.UUIDToString(parent.ID),
		"child_task_id", util.UUIDToString(child.ID),
		"reason", reason,
		"attempt", child.Attempt,
		"max_attempts", child.MaxAttempts,
	)
	// Retry creates a fresh queued row, same status transition (∅ → queued)
	// as EnqueueTaskFor*. Broadcast queued first, then notify the daemon —
	// see EnqueueTaskForIssue for ordering rationale.
	s.broadcastTaskEvent(ctx, protocol.EventTaskQueued, child)
	s.notifyTaskAvailable(child)
	return &child, nil
}

// RerunIssue creates a fresh queued task for the agent currently assigned
// to the issue. Used by the manual rerun endpoint.
//
// The new task is flagged force_fresh_session=true so the daemon starts a
// clean agent session instead of resuming the prior (agent_id, issue_id)
// session. A user clicking rerun has just judged the prior output bad —
// resuming the same conversation would replay the same poisoned state.
// Auto-retry of an orphaned mid-flight failure (HandleFailedTasks →
// MaybeRetryFailedTask → CreateRetryTask) does NOT take this path, so
// MUL-1128's mid-flight resume contract is preserved.
//
// Only tasks belonging to the issue's current assignee are cancelled.
// Tasks owned by other agents on the same issue (e.g. a parallel
// @-mention agent) are left alone — rerun must not collateral-cancel
// them.
func (s *TaskService) RerunIssue(ctx context.Context, issueID pgtype.UUID, triggerCommentID pgtype.UUID) (*db.AgentTaskQueue, error) {
	issue, err := s.Queries.GetIssue(ctx, issueID)
	if err != nil {
		return nil, fmt.Errorf("load issue: %w", err)
	}
	if !issue.AssigneeID.Valid || issue.AssigneeType.String != "agent" {
		return nil, fmt.Errorf("issue is not assigned to an agent")
	}
	// Cancel only the assignee's active/queued tasks on this issue. This
	// covers both the unique-index conflict (queued/dispatched) and a
	// stuck running task without touching other agents on the issue.
	cancelled, err := s.Queries.CancelAgentTasksByIssueAndAgent(ctx, db.CancelAgentTasksByIssueAndAgentParams{
		IssueID: issueID,
		AgentID: issue.AssigneeID,
	})
	if err != nil {
		slog.Warn("rerun: cancel prior tasks failed",
			"issue_id", util.UUIDToString(issueID),
			"agent_id", util.UUIDToString(issue.AssigneeID),
			"error", err,
		)
	}
	for _, t := range cancelled {
		s.ReconcileAgentStatus(ctx, t.AgentID)
		s.broadcastTaskEvent(ctx, protocol.EventTaskCancelled, t)
	}

	task, err := s.enqueueIssueTask(ctx, issue, triggerCommentID, true)
	if err != nil {
		return nil, err
	}
	slog.Info("issue rerun enqueued",
		"task_id", util.UUIDToString(task.ID),
		"issue_id", util.UUIDToString(issueID),
		"agent_id", util.UUIDToString(issue.AssigneeID),
		"cancelled_prior", len(cancelled),
	)
	return &task, nil
}

// HandleFailedTasks runs the post-failure side effects for a batch of
// freshly-failed tasks: optional auto-retry, task:failed event broadcast,
// agent status reconciliation, and (when an issue has no remaining active
// task and isn't being retried) resetting the issue back to todo so the
// daemon can pick it up again.
//
// All callers that surface a task as failed — sweepers, FailTask,
// recover-orphans — funnel through here so the same UI-consistency
// guarantees apply on every code path.
func (s *TaskService) HandleFailedTasks(ctx context.Context, tasks []db.AgentTaskQueue) int {
	if len(tasks) == 0 {
		return 0
	}

	affectedAgents := make(map[string]pgtype.UUID)
	processedIssues := make(map[string]bool)
	retriedIssues := make(map[string]bool)
	retried := 0

	for _, t := range tasks {
		// Auto-retry first so the issue stays in_progress rather than
		// flapping todo → in_progress within a tick.
		if child, _ := s.MaybeRetryFailedTask(ctx, t); child != nil {
			retried++
			if t.IssueID.Valid {
				retriedIssues[util.UUIDToString(t.IssueID)] = true
			}
		}

		failureReason := "agent_error"
		if t.FailureReason.Valid && t.FailureReason.String != "" {
			failureReason = t.FailureReason.String
		}

		workspaceID := ""
		if t.IssueID.Valid {
			if issue, err := s.Queries.GetIssue(ctx, t.IssueID); err == nil {
				workspaceID = util.UUIDToString(issue.WorkspaceID)
				// Reset stuck in_progress issues only when no other active
				// task exists for the issue and no retry was just enqueued.
				issueKey := util.UUIDToString(t.IssueID)
				if issue.Status == "in_progress" && !processedIssues[issueKey] && !retriedIssues[issueKey] {
					processedIssues[issueKey] = true
					hasActive, checkErr := s.Queries.HasActiveTaskForIssue(ctx, t.IssueID)
					if checkErr != nil {
						slog.Warn("handle failed tasks: active check failed",
							"issue_id", issueKey,
							"error", checkErr,
						)
					} else if !hasActive {
						if _, updateErr := s.Queries.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
							ID:     t.IssueID,
							Status: "todo",
						}); updateErr != nil {
							slog.Warn("handle failed tasks: reset stuck issue failed",
								"issue_id", issueKey,
								"error", updateErr,
							)
						}
					}
				}
			}
		}
		if workspaceID == "" {
			workspaceID = s.ResolveTaskWorkspaceID(ctx, t)
		}

		if workspaceID != "" {
			s.Bus.Publish(events.Event{
				Type:        protocol.EventTaskFailed,
				WorkspaceID: workspaceID,
				ActorType:   "system",
				Payload: map[string]any{
					"task_id":        util.UUIDToString(t.ID),
					"agent_id":       util.UUIDToString(t.AgentID),
					"issue_id":       util.UUIDToString(t.IssueID),
					"status":         "failed",
					"failure_reason": failureReason,
				},
			})
		}

		affectedAgents[util.UUIDToString(t.AgentID)] = t.AgentID
	}

	for _, agentID := range affectedAgents {
		s.ReconcileAgentStatus(ctx, agentID)
	}
	return retried
}

// runInTx executes fn inside a single DB transaction. If TxStarter is nil
// (e.g. some tests construct TaskService directly), fn runs against the
// regular Queries handle without transactional guarantees.
func (s *TaskService) runInTx(ctx context.Context, fn func(*db.Queries) error) error {
	if s.TxStarter == nil {
		return fn(s.Queries)
	}
	tx, err := s.TxStarter.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := fn(s.Queries.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ReportProgress broadcasts a progress update via the event bus.
func (s *TaskService) ReportProgress(ctx context.Context, taskID string, workspaceID string, summary string, step, total int) {
	s.Bus.Publish(events.Event{
		Type:        protocol.EventTaskProgress,
		WorkspaceID: workspaceID,
		ActorType:   "system",
		ActorID:     "",
		TaskID:      taskID,
		Payload: protocol.TaskProgressPayload{
			TaskID:  taskID,
			Summary: summary,
			Step:    step,
			Total:   total,
		},
	})
}

// ReconcileAgentStatus refreshes agent status from the current active task set.
func (s *TaskService) ReconcileAgentStatus(ctx context.Context, agentID pgtype.UUID) {
	agent, err := s.Queries.RefreshAgentStatusFromTasks(ctx, agentID)
	if err != nil {
		return
	}
	slog.Debug("agent status reconciled", "agent_id", util.UUIDToString(agentID), "status", agent.Status)
	s.publishAgentStatus(agent)
}

func (s *TaskService) updateAgentStatus(ctx context.Context, agentID pgtype.UUID, status string) {
	agent, err := s.Queries.UpdateAgentStatus(ctx, db.UpdateAgentStatusParams{
		ID:     agentID,
		Status: status,
	})
	if err != nil {
		return
	}
	s.publishAgentStatus(agent)
}

func (s *TaskService) publishAgentStatus(agent db.Agent) {
	s.Bus.Publish(events.Event{
		Type:        protocol.EventAgentStatus,
		WorkspaceID: util.UUIDToString(agent.WorkspaceID),
		ActorType:   "system",
		ActorID:     "",
		Payload:     map[string]any{"agent": agentToMap(agent)},
	})
}

// LoadAgentSkills loads an agent's skills with their files for task execution.
func (s *TaskService) LoadAgentSkills(ctx context.Context, agentID pgtype.UUID) []AgentSkillData {
	skills, err := s.Queries.ListAgentSkills(ctx, agentID)
	if err != nil || len(skills) == 0 {
		return nil
	}

	result := make([]AgentSkillData, 0, len(skills))
	for _, sk := range skills {
		data := AgentSkillData{Name: sk.Name, Content: sk.Content}
		files, _ := s.Queries.ListSkillFiles(ctx, sk.ID)
		for _, f := range files {
			data.Files = append(data.Files, AgentSkillFileData{Path: f.Path, Content: f.Content})
		}
		result = append(result, data)
	}
	return result
}

// AgentSkillData represents a skill for task execution responses.
type AgentSkillData struct {
	Name    string               `json:"name"`
	Content string               `json:"content"`
	Files   []AgentSkillFileData `json:"files,omitempty"`
}

// AgentSkillFileData represents a supporting file within a skill.
type AgentSkillFileData struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

const ChatSkillInvocationContextType = "chat_skill_invocation"

type ChatSkillInvocationContext struct {
	Type     string   `json:"type"`
	SkillIDs []string `json:"skill_ids"`
}

func BuildChatSkillInvocationContext(skillIDs []string) ([]byte, bool) {
	seen := make(map[string]struct{}, len(skillIDs))
	normalized := make([]string, 0, len(skillIDs))
	for _, raw := range skillIDs {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		normalized = append(normalized, id)
	}
	if len(normalized) == 0 {
		return nil, false
	}
	payload, err := json.Marshal(ChatSkillInvocationContext{
		Type:     ChatSkillInvocationContextType,
		SkillIDs: normalized,
	})
	if err != nil {
		return nil, false
	}
	return payload, true
}

func ParseChatSkillInvocationContext(raw []byte) (ChatSkillInvocationContext, bool) {
	if len(raw) == 0 {
		return ChatSkillInvocationContext{}, false
	}
	var ctx ChatSkillInvocationContext
	if err := json.Unmarshal(raw, &ctx); err != nil {
		return ChatSkillInvocationContext{}, false
	}
	if ctx.Type != ChatSkillInvocationContextType || len(ctx.SkillIDs) == 0 {
		return ChatSkillInvocationContext{}, false
	}
	return ctx, true
}

func (s *TaskService) LoadAgentSkillsForTask(ctx context.Context, agentID, workspaceID pgtype.UUID, taskContext []byte) ([]AgentSkillData, []string) {
	skills := s.LoadAgentSkills(ctx, agentID)
	invocation, ok := ParseChatSkillInvocationContext(taskContext)
	if !ok {
		return skills, nil
	}

	seenNames := make(map[string]struct{}, len(skills)+len(invocation.SkillIDs))
	for _, skill := range skills {
		seenNames[strings.ToLower(skill.Name)] = struct{}{}
	}

	requestedNames := make([]string, 0, len(invocation.SkillIDs))
	for _, rawID := range invocation.SkillIDs {
		skillID, err := util.ParseUUID(rawID)
		if err != nil {
			slog.Warn("chat skill invocation has invalid skill id", "skill_id", rawID, "error", err)
			continue
		}
		skill, err := s.Queries.GetSkillInWorkspace(ctx, db.GetSkillInWorkspaceParams{
			ID:          skillID,
			WorkspaceID: workspaceID,
		})
		if err != nil {
			slog.Warn("chat skill invocation references missing skill", "skill_id", rawID, "error", err)
			continue
		}
		requestedNames = append(requestedNames, skill.Name)
		key := strings.ToLower(skill.Name)
		if _, exists := seenNames[key]; exists {
			continue
		}
		seenNames[key] = struct{}{}
		data := AgentSkillData{Name: skill.Name, Content: skill.Content}
		files, _ := s.Queries.ListSkillFiles(ctx, skill.ID)
		for _, f := range files {
			data.Files = append(data.Files, AgentSkillFileData{Path: f.Path, Content: f.Content})
		}
		skills = append(skills, data)
	}
	return skills, requestedNames
}

// computeChatElapsedMs returns the wall-clock duration from task creation
// (user hit send) to terminal state (completed/failed). Stored on the
// assistant chat_message so the UI can render "Replied in 38s" /
// "Failed after 12s". Uses created_at — not started_at — because users
// experience total wait time, including queue + dispatch, not just the
// daemon's actual run time.
// senderAgentForChatSession returns the agent UUID to attribute an assistant
// message to, in any multi-agent chat shape. 1:1 direct chat sessions return
// an invalid (NULL) UUID so the legacy "no avatar override" behavior is
// preserved.
//
// Multi-agent shapes that DO need attribution:
//   - team chat sessions (chat_session.team_id valid)
//   - council session fan-out tasks (task.context type = council_broadcast)
//   - any chat_session borrowed by a running council_session as its
//     source_chat_session_id (covers per-member replies even when the
//     individual task was not flagged as a broadcast — for example when
//     another agent posts a direct reply in the room)
//
// Without this attribution, every assistant message in a Council room would
// look like it came from the same anonymous agent and the UI cannot render
// the 8-bubble fan-out the user actually sees.
func (s *TaskService) senderAgentForChatSession(ctx context.Context, task db.AgentTaskQueue) pgtype.UUID {
	if !task.ChatSessionID.Valid || !task.AgentID.Valid {
		return pgtype.UUID{}
	}
	if len(task.Context) > 0 {
		var bc CouncilBroadcastContext
		if json.Unmarshal(task.Context, &bc) == nil && bc.Type == CouncilBroadcastContextType {
			return task.AgentID
		}
	}
	session, err := s.Queries.GetChatSession(ctx, task.ChatSessionID)
	if err != nil {
		// Don't fail the completion just because we can't decide attribution —
		// fall back to NULL like a 1:1 session would.
		slog.Warn("sender_agent_id lookup failed",
			"chat_session_id", util.UUIDToString(task.ChatSessionID),
			"error", err)
		return pgtype.UUID{}
	}
	if session.TeamID.Valid {
		return task.AgentID
	}
	// Council session check: even outside the team_id path, a chat_session
	// can be the source of a running council; in that case every assistant
	// reply belongs to a specific participant and the UI needs the avatar.
	if _, err := s.Queries.GetRunningCouncilSessionBySourceChat(ctx, db.GetRunningCouncilSessionBySourceChatParams{
		SourceChatSessionID: task.ChatSessionID,
		WorkspaceID:         session.WorkspaceID,
	}); err == nil {
		return task.AgentID
	}
	return pgtype.UUID{}
}

func computeChatElapsedMs(task db.AgentTaskQueue) pgtype.Int8 {
	if !task.CompletedAt.Valid || !task.CreatedAt.Valid {
		return pgtype.Int8{}
	}
	ms := task.CompletedAt.Time.Sub(task.CreatedAt.Time).Milliseconds()
	if ms < 0 {
		ms = 0
	}
	return pgtype.Int8{Int64: ms, Valid: true}
}

func priorityToInt(p string) int32 {
	switch p {
	case "urgent":
		return 4
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}

// NotifyTaskEnqueued is the cross-package shim for callers outside
// TaskService (e.g. AutopilotService.dispatchRunOnly) that insert a
// row into agent_task_queue directly. Invalidates the empty-claim
// cache and kicks the daemon WS so the new task is claimed without
// waiting for the next poll.
func (s *TaskService) NotifyTaskEnqueued(task db.AgentTaskQueue) {
	s.notifyTaskAvailable(task)
}

// notifyTaskAvailable runs after a task has been inserted: bumps the
// runtime's invalidation version so any in-flight claim that is about
// to write an "empty" verdict will have it rejected on read, then
// kicks the daemon WS so the daemon claims without waiting for its
// next poll. Order matters — Bump must happen before the wakeup,
// otherwise the wakeup-driven claim could read the still-current
// empty verdict and return null.
func (s *TaskService) notifyTaskAvailable(task db.AgentTaskQueue) {
	if !task.RuntimeID.Valid {
		return
	}
	runtimeKey := util.UUIDToString(task.RuntimeID)
	// Use a background context: the cache bump / wakeup must outlive
	// the request that created the task, otherwise an early client
	// disconnect could leave the empty verdict in place and stall the
	// just-queued task until the TTL expires. The cache itself bounds
	// every Redis call with a short timeout so a wedged Redis cannot
	// block enqueue.
	s.EmptyClaim.Bump(context.Background(), runtimeKey)
	if s.Wakeup == nil {
		return
	}
	s.Wakeup.NotifyTaskAvailable(runtimeKey, util.UUIDToString(task.ID))
}

func (s *TaskService) broadcastTaskDispatch(ctx context.Context, task db.AgentTaskQueue) {
	var payload map[string]any
	if task.Context != nil {
		json.Unmarshal(task.Context, &payload)
	}
	if payload == nil {
		payload = map[string]any{}
	}
	payload["task_id"] = util.UUIDToString(task.ID)
	payload["runtime_id"] = util.UUIDToString(task.RuntimeID)
	payload["issue_id"] = util.UUIDToString(task.IssueID)
	payload["agent_id"] = util.UUIDToString(task.AgentID)
	// chat_session_id is the routing key the chat window uses to writethrough
	// `chatKeys.pendingTask` to status="running" the moment the daemon claims
	// the task. Without it the pill stays stuck at "Queued" until completion.
	if task.ChatSessionID.Valid {
		payload["chat_session_id"] = util.UUIDToString(task.ChatSessionID)
	}

	workspaceID := s.ResolveTaskWorkspaceID(ctx, task)
	if workspaceID == "" {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventTaskDispatch,
		WorkspaceID: workspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload:     payload,
	})
}

func (s *TaskService) broadcastTaskEvent(ctx context.Context, eventType string, task db.AgentTaskQueue) {
	workspaceID := s.ResolveTaskWorkspaceID(ctx, task)
	if workspaceID == "" {
		return
	}
	payload := map[string]any{
		"task_id":  util.UUIDToString(task.ID),
		"agent_id": util.UUIDToString(task.AgentID),
		"issue_id": util.UUIDToString(task.IssueID),
		"status":   task.Status,
	}
	if task.ChatSessionID.Valid {
		payload["chat_session_id"] = util.UUIDToString(task.ChatSessionID)
	}
	if pc, ok := s.parseProjectCompactionContext(task); ok {
		payload["type"] = pc.Type
		payload["project_id"] = pc.ProjectID
	}
	s.Bus.Publish(events.Event{
		Type:        eventType,
		WorkspaceID: workspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload:     payload,
	})
}

// ResolveTaskWorkspaceID determines the workspace ID for a task.
// For issue tasks, it comes from the issue. For chat tasks, from the chat session.
// For autopilot tasks, from the autopilot via its run.
// Returns "" when none of the links resolve — callers treat that as "not found".
func (s *TaskService) ResolveTaskWorkspaceID(ctx context.Context, task db.AgentTaskQueue) string {
	if task.IssueID.Valid {
		if issue, err := s.Queries.GetIssue(ctx, task.IssueID); err == nil {
			return util.UUIDToString(issue.WorkspaceID)
		}
	}
	if task.ChatSessionID.Valid {
		if cs, err := s.Queries.GetChatSession(ctx, task.ChatSessionID); err == nil {
			return util.UUIDToString(cs.WorkspaceID)
		}
	}
	if task.AutopilotRunID.Valid {
		if run, err := s.Queries.GetAutopilotRun(ctx, task.AutopilotRunID); err == nil {
			if ap, err := s.Queries.GetAutopilot(ctx, run.AutopilotID); err == nil {
				return util.UUIDToString(ap.WorkspaceID)
			}
		}
	}
	// Quick-create tasks have no issue / chat / autopilot link — workspace
	// lives in the context JSONB. Returning "" here is what blocked
	// requireDaemonTaskAccess (404 on /start, /progress, /complete, /fail
	// for the daemon) and silently dropped task:dispatch / task:completed
	// broadcasts, which is why quick-create tasks appeared stuck queued.
	if qc, ok := s.parseQuickCreateContext(task); ok {
		return qc.WorkspaceID
	}
	if pc, ok := s.parseProjectCompactionContext(task); ok {
		return pc.WorkspaceID
	}
	return ""
}

func (s *TaskService) broadcastChatDone(ctx context.Context, task db.AgentTaskQueue) {
	workspaceID := s.ResolveTaskWorkspaceID(ctx, task)
	if workspaceID == "" {
		return
	}
	s.Bus.Publish(events.Event{
		Type:          protocol.EventChatDone,
		WorkspaceID:   workspaceID,
		ActorType:     "system",
		ActorID:       "",
		ChatSessionID: util.UUIDToString(task.ChatSessionID),
		Payload: protocol.ChatDonePayload{
			ChatSessionID: util.UUIDToString(task.ChatSessionID),
			TaskID:        util.UUIDToString(task.ID),
		},
	})
}

// broadcastTeamMessageIfTeamSession fires a workspace-wide team:message_created
// event when a chat task that belongs to a team session lands an assistant
// row. Payload includes the message so the frontend can append it without
// refetching the whole room; missing message falls back to invalidate.
//
// 1:1 sessions short-circuit (returns immediately) — those flow through
// chat:* events and don't need a team broadcast.
func (s *TaskService) broadcastTeamMessageIfTeamSession(ctx context.Context, task db.AgentTaskQueue) {
	if !task.ChatSessionID.Valid {
		return
	}
	session, err := s.Queries.GetChatSession(ctx, task.ChatSessionID)
	if err != nil || !session.TeamID.Valid {
		return
	}
	message, err := s.Queries.GetLatestTeamChatMessageForTask(ctx, db.GetLatestTeamChatMessageForTaskParams{
		TeamID: session.TeamID,
		TaskID: task.ID,
	})
	if err != nil {
		slog.Warn("failed to load latest team task message",
			"task_id", util.UUIDToString(task.ID),
			"team_id", util.UUIDToString(session.TeamID),
			"error", err)
	}
	var messagePtr *db.ChatMessage
	if err == nil {
		messagePtr = &message
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventTeamMessageCreated,
		WorkspaceID: util.UUIDToString(session.WorkspaceID),
		ActorType:   "agent",
		ActorID:     util.UUIDToString(task.AgentID),
		Payload:     teamMessageEventPayloadForSession(session, session.TeamID, messagePtr),
	})
}

func teamMessageEventPayloadForSession(session db.ChatSession, teamID pgtype.UUID, message *db.ChatMessage) map[string]any {
	payload := map[string]any{
		"team_id": util.UUIDToString(teamID),
	}
	if session.ProjectID.Valid {
		payload["project_id"] = util.UUIDToString(session.ProjectID)
	}
	if message != nil {
		payload["message"] = map[string]any{
			"id":              util.UUIDToString(message.ID),
			"chat_session_id": util.UUIDToString(message.ChatSessionID),
			"team_id":         util.UUIDToString(teamID),
			"role":            message.Role,
			"content":         message.Content,
			"sender_agent_id": util.UUIDToPtr(message.SenderAgentID),
			"created_at":      util.TimestampToString(message.CreatedAt),
		}
	}
	return payload
}

type teamRosterAgent struct {
	ID   pgtype.UUID
	Name string
	Role string
}

type memoryCandidate struct {
	Kind  string
	Title string
	Body  string
}

func (s *TaskService) handleTeamAssistantMessage(ctx context.Context, task db.AgentTaskQueue, message db.ChatMessage) {
	session, err := s.Queries.GetChatSession(ctx, task.ChatSessionID)
	if err != nil || !session.TeamID.Valid {
		return
	}
	team, err := s.Queries.GetTeam(ctx, session.TeamID)
	if err != nil {
		return
	}
	roster := s.loadTeamRosterAgents(ctx, team.ID)
	if uuidEqual(task.AgentID, team.CaptainAgentID) {
		s.delegateTeamMentions(ctx, session, team, roster, task.AgentID, message)
	}
	s.extractTeamMemories(ctx, session, team, task.AgentID, message)
}

func (s *TaskService) loadTeamRosterAgents(ctx context.Context, teamID pgtype.UUID) []teamRosterAgent {
	members, err := s.Queries.ListTeamMembers(ctx, teamID)
	if err != nil {
		return nil
	}
	out := make([]teamRosterAgent, 0, len(members))
	for _, member := range members {
		agent, err := s.Queries.GetAgent(ctx, member.AgentID)
		if err != nil {
			continue
		}
		out = append(out, teamRosterAgent{ID: member.AgentID, Name: agent.Name, Role: member.Role})
	}
	return out
}

func (s *TaskService) delegateTeamMentions(ctx context.Context, session db.ChatSession, team db.Team, roster []teamRosterAgent, sourceAgentID pgtype.UUID, sourceMessage db.ChatMessage) {
	// D 方案 (Origin §17 v1.2 + 团队群聊 issue 卡片复用):
	// captain 在群聊里 @ 派活时不再起独立 chat task，改为创建一个 issue
	// 卡片，assignee = 被 @ 的 agent，source_team_message_id 指回 captain
	// 这条 message。issue 创建后既有的 issue assignment 链路自动 enqueue
	// task；agent 干完写 issue comment 后由 mirrorIssueCompletionToTeamSession
	// 把结果同步回群聊。
	content := sourceMessage.Content
	tasks := parseTeamMentionTasks(roster, sourceAgentID, content)
	if len(tasks) == 0 {
		return
	}

	sourceAgentName := ""
	for _, member := range roster {
		if uuidEqual(member.ID, sourceAgentID) {
			sourceAgentName = member.Name
			break
		}
	}

	var delegated []string
	var failed []string
	for _, t := range tasks {
		issue, err := s.createTeamMentionIssue(ctx, session, team, sourceMessage, t)
		if err != nil {
			failed = append(failed, t.AgentName)
			slog.Warn("team delegation issue creation failed",
				"team_id", util.UUIDToString(team.ID),
				"source_agent_id", util.UUIDToString(sourceAgentID),
				"target_agent_id", util.UUIDToString(t.AgentID),
				"error", err)
			continue
		}
		// issue 创建后自动 enqueue assignment task（沿用 v1.0 issue 流）。
		if _, err := s.EnqueueTaskForIssue(ctx, issue); err != nil {
			failed = append(failed, t.AgentName)
			s.markDelegationIssueBlocked(ctx, issue, err)
			slog.Warn("team delegation issue task enqueue failed",
				"issue_id", util.UUIDToString(issue.ID),
				"target_agent_id", util.UUIDToString(t.AgentID),
				"error", err)
			continue
		}
		delegated = append(delegated, t.AgentName)
		payload, _ := json.Marshal(map[string]any{
			"team_id":         util.UUIDToString(team.ID),
			"chat_session_id": util.UUIDToString(session.ID),
			"source_agent_id": util.UUIDToString(sourceAgentID),
			"target_agent_id": util.UUIDToString(t.AgentID),
			"issue_id":        util.UUIDToString(issue.ID),
			"issue_number":    issue.Number,
		})
		if _, err := s.Queries.CreateAgentEvent(ctx, db.CreateAgentEventParams{
			WorkspaceID: team.WorkspaceID,
			AgentID:     t.AgentID,
			Kind:        "team_task_delegated",
			Title:       "团队负责人分派了群聊任务",
			Body:        truncateForSummary(t.TaskText, triggerSummaryMaxLen),
			Payload:     payload,
		}); err == nil {
			s.publishAgentEvent(ctx, team.WorkspaceID, t.AgentID)
		}
	}

	body := ""
	if len(delegated) > 0 {
		body = fmt.Sprintf("负责人 %s 已派任务给 %s（共 %d 张任务卡片）。", sourceAgentName, strings.Join(delegated, "、"), len(delegated))
	}
	if len(failed) > 0 {
		if body != "" {
			body += " "
		}
		body += "以下成员暂时无法接管：" + strings.Join(failed, "、") + "。"
	}
	if body != "" {
		s.createTeamSystemMessage(ctx, session, team.ID, body)
	}
}

func (s *TaskService) markDelegationIssueBlocked(ctx context.Context, issue db.Issue, enqueueErr error) {
	updated, err := s.Queries.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
		ID:     issue.ID,
		Status: "blocked",
	})
	if err == nil {
		issue = updated
	}
	reason := strings.TrimSpace(enqueueErr.Error())
	if reason == "" {
		reason = "agent task enqueue failed"
	}
	s.createAgentComment(
		ctx,
		issue.ID,
		issue.AssigneeID,
		"任务暂时无法启动："+reason+"。请检查 agent runtime 后重新派发或手动处理。",
		"system",
		pgtype.UUID{},
	)
	s.broadcastIssueUpdated(issue)
}

// teamMentionTask 是从 captain reply 里解析出的一条派活：被 @ 的 agent +
// 该 agent 应该执行的指令文本（@token 之后到下一个 @token 或段落末尾）。
type teamMentionTask struct {
	AgentID   pgtype.UUID
	AgentName string
	TaskText  string
}

// parseTeamMentionTasks 解析 captain 消息里的 @ 派活：每个 @成员名 后续
// 文本（到下一个 @ 或段落结束）作为该成员的任务。@全体 → 所有人共享全文。
func parseTeamMentionTasks(roster []teamRosterAgent, sourceAgentID pgtype.UUID, content string) []teamMentionTask {
	rs := []rune(content)
	type segment struct {
		token string
		start int
		end   int
	}
	var segs []segment
	for i := 0; i < len(rs); i++ {
		if rs[i] != '@' {
			continue
		}
		j := i + 1
		for j < len(rs) {
			r := rs[j]
			if unicode.IsSpace(r) || strings.ContainsRune("，。,.!！?？:：;；()（）[]【】<>《》\"'“”‘’", r) {
				break
			}
			j++
		}
		token := strings.TrimSpace(string(rs[i+1 : j]))
		if token != "" {
			segs = append(segs, segment{token: token, start: i, end: j})
		}
		i = j
	}
	if len(segs) == 0 {
		return nil
	}
	// 给每个 segment 算它的任务文本范围：到下一个 segment 之前。
	var out []teamMentionTask
	for idx, seg := range segs {
		taskEnd := len(rs)
		if idx+1 < len(segs) {
			taskEnd = segs[idx+1].start
		}
		taskText := strings.TrimSpace(string(rs[seg.end:taskEnd]))
		// @全体 → 所有 roster 成员共享全文（除了 source agent 自己）
		if seg.token == "全体" || strings.EqualFold(seg.token, "all") || strings.EqualFold(seg.token, "everyone") {
			fullContent := strings.TrimSpace(content)
			for _, member := range roster {
				if uuidEqual(member.ID, sourceAgentID) {
					continue
				}
				out = append(out, teamMentionTask{
					AgentID:   member.ID,
					AgentName: member.Name,
					TaskText:  fullContent,
				})
			}
			continue
		}
		// 普通 @成员名 → 该成员独占这段任务
		for _, member := range roster {
			if uuidEqual(member.ID, sourceAgentID) {
				continue
			}
			if teamMentionMatches(seg.token, member.Name) {
				if taskText == "" {
					// 没有具体指令文本时回落到全文，避免空任务
					taskText = strings.TrimSpace(content)
				}
				out = append(out, teamMentionTask{
					AgentID:   member.ID,
					AgentName: member.Name,
					TaskText:  taskText,
				})
				break
			}
		}
	}
	// 按 AgentID 去重（如果 captain 在同一段里 @ 了同一个人多次）
	seen := map[string]bool{}
	deduped := make([]teamMentionTask, 0, len(out))
	for _, t := range out {
		key := util.UUIDToString(t.AgentID)
		if seen[key] {
			continue
		}
		seen[key] = true
		deduped = append(deduped, t)
	}
	return deduped
}

// createTeamMentionIssue 把一条 @ 派活落成 issue。Title 取 TaskText 第一行
// 截断 60 字；description 是 TaskText 全文（可能含 markdown）；
// source_team_message_id / source_team_session_id 指回 captain message + 群聊
// session，作为完成回流的桥梁。
func (s *TaskService) createTeamMentionIssue(ctx context.Context, session db.ChatSession, team db.Team, sourceMessage db.ChatMessage, t teamMentionTask) (db.Issue, error) {
	title := teamMentionTaskTitle(t.TaskText, t.AgentName)
	number, err := s.Queries.IncrementIssueCounter(ctx, team.WorkspaceID)
	if err != nil {
		return db.Issue{}, fmt.Errorf("issue counter: %w", err)
	}
	issue, err := s.Queries.CreateIssueFromTeamMessage(ctx, db.CreateIssueFromTeamMessageParams{
		WorkspaceID:         team.WorkspaceID,
		Title:               title,
		Description:         pgtype.Text{String: t.TaskText, Valid: t.TaskText != ""},
		Status:              "todo",
		Priority:            "medium",
		AssigneeType:        pgtype.Text{String: "agent", Valid: true},
		AssigneeID:          pgtype.UUID{Bytes: t.AgentID.Bytes, Valid: true},
		CreatorType:         "agent",
		CreatorID:           sourceMessage.SenderAgentID,
		ParentIssueID:       pgtype.UUID{},
		Position:            0,
		DueDate:             pgtype.Timestamptz{},
		Number:              number,
		ProjectID:           session.ProjectID,
		SourceTeamMessageID: pgtype.UUID{Bytes: sourceMessage.ID.Bytes, Valid: true},
		SourceTeamSessionID: pgtype.UUID{Bytes: session.ID.Bytes, Valid: true},
	})
	if err != nil {
		return db.Issue{}, fmt.Errorf("create issue: %w", err)
	}
	return issue, nil
}

// MirrorIssueCompletionToTeamSession runs when a delegated-from-team-chat
// issue lands in in_review / done. It emits a compact team_task_completed
// event so the delegation board / task card UI can refresh. The assignee's
// detailed output stays in issue comments and task-card detail; mirroring it
// into the main chat duplicates long result bodies and makes the group thread
// noisy.
func (s *TaskService) MirrorIssueCompletionToTeamSession(ctx context.Context, issue db.Issue) {
	if !issue.SourceTeamSessionID.Valid {
		return
	}
	session, err := s.Queries.GetChatSession(ctx, issue.SourceTeamSessionID)
	if err != nil {
		return
	}
	if !session.TeamID.Valid {
		return
	}

	payload := map[string]any{
		"team_id":                util.UUIDToString(session.TeamID),
		"chat_session_id":        util.UUIDToString(session.ID),
		"issue_id":               util.UUIDToString(issue.ID),
		"source_team_session_id": util.UUIDToString(issue.SourceTeamSessionID),
		"event":                  "team_task_completed",
	}
	if issue.SourceTeamMessageID.Valid {
		payload["source_team_message_id"] = util.UUIDToString(issue.SourceTeamMessageID)
	}
	if session.ProjectID.Valid {
		payload["project_id"] = util.UUIDToString(session.ProjectID)
	}

	s.Bus.Publish(events.Event{
		Type:        protocol.EventTeamMessageCreated,
		WorkspaceID: util.UUIDToString(session.WorkspaceID),
		ActorType:   "agent",
		ActorID:     util.UUIDToString(issue.AssigneeID),
		Payload:     payload,
	})
}

// teamMentionTaskTitle 从派活文本里抽一行作为 issue 标题。优先第一行，
// 截断到 60 字；如果空则回落到「Agent 的群聊任务」。
func teamMentionTaskTitle(taskText, agentName string) string {
	first := strings.TrimSpace(taskText)
	if newline := strings.IndexAny(first, "\n。；;"); newline > 0 {
		first = strings.TrimSpace(first[:newline])
	}
	rs := []rune(first)
	if len(rs) > 60 {
		first = string(rs[:60]) + "…"
	}
	if first == "" {
		first = agentName + " 的群聊任务"
	}
	return first
}

func (s *TaskService) activeMissionForTeamSession(ctx context.Context, session db.ChatSession, team db.Team) (db.Mission, bool) {
	if !session.ID.Valid || !team.ID.Valid {
		return db.Mission{}, false
	}
	mission, err := s.Queries.GetActiveMissionByTeamChatSession(ctx, db.GetActiveMissionByTeamChatSessionParams{
		TeamID:        team.ID,
		ChatSessionID: session.ID,
	})
	if err != nil {
		return db.Mission{}, false
	}
	return mission, true
}

func (s *TaskService) createMissionDelegation(ctx context.Context, mission db.Mission, team db.Team, target teamRosterAgent, sourceAgentID pgtype.UUID, sourceMessage db.ChatMessage, task db.AgentTaskQueue) {
	title := delegationPlanTitle(sourceMessage.Content, target.Name)
	body := truncateForSummary(sourceMessage.Content, triggerSummaryMaxLen)
	sortOrder := int32(time.Now().Unix())
	planItem, err := s.Queries.CreateMissionPlanItem(ctx, db.CreateMissionPlanItemParams{
		MissionID:       mission.ID,
		Title:           title,
		Description:     body,
		Phase:           "execute",
		Status:          "in_progress",
		Priority:        "medium",
		RiskLevel:       mission.RiskLevel,
		SortOrder:       sortOrder,
		AssignedAgentID: target.ID,
	})
	if err != nil {
		slog.Warn("failed to create mission delegation plan item",
			"mission_id", util.UUIDToString(mission.ID),
			"target_agent_id", util.UUIDToString(target.ID),
			"error", err)
		return
	}
	assignment, err := s.Queries.CreateMissionAssignment(ctx, db.CreateMissionAssignmentParams{
		MissionID:  mission.ID,
		PlanItemID: planItem.ID,
		AgentID:    target.ID,
		Status:     "dispatched",
		RiskLevel:  mission.RiskLevel,
		TaskID:     task.ID,
		Output:     "",
	})
	if err != nil {
		slog.Warn("failed to create mission delegation assignment",
			"mission_id", util.UUIDToString(mission.ID),
			"target_agent_id", util.UUIDToString(target.ID),
			"task_id", util.UUIDToString(task.ID),
			"error", err)
		return
	}
	if _, err := s.Queries.CreateMissionEvent(ctx, db.CreateMissionEventParams{
		MissionID:   mission.ID,
		WorkspaceID: mission.WorkspaceID,
		ActorType:   "agent",
		ActorID:     sourceAgentID,
		Kind:        "member_delegated",
		Title:       "负责人派工给 " + target.Name,
		Body:        body,
		Payload: eventPayload(map[string]any{
			"team_id":           util.UUIDToString(team.ID),
			"chat_session_id":   util.UUIDToString(sourceMessage.ChatSessionID),
			"source_agent_id":   util.UUIDToString(sourceAgentID),
			"target_agent_id":   util.UUIDToString(target.ID),
			"source_message_id": util.UUIDToString(sourceMessage.ID),
			"plan_item_id":      util.UUIDToString(planItem.ID),
			"assignment_id":     util.UUIDToString(assignment.ID),
			"task_id":           util.UUIDToString(task.ID),
		}),
	}); err != nil {
		slog.Warn("failed to create mission delegation event",
			"mission_id", util.UUIDToString(mission.ID),
			"target_agent_id", util.UUIDToString(target.ID),
			"error", err)
		return
	}
	s.publishMissionUpdated(ctx, mission.WorkspaceID, mission.ID)
}

func delegationPlanTitle(content, targetName string) string {
	text := strings.TrimSpace(content)
	if text == "" {
		return targetName + " 执行负责人分派任务"
	}
	text = strings.ReplaceAll(text, "@"+targetName, "")
	text = strings.TrimSpace(text)
	if text == "" {
		return targetName + " 执行负责人分派任务"
	}
	return targetName + " · " + truncateForSummary(text, 42)
}

func (s *TaskService) createTeamSystemMessage(ctx context.Context, session db.ChatSession, teamID pgtype.UUID, content string) {
	if strings.TrimSpace(content) == "" {
		return
	}
	message, err := s.Queries.CreateTeamChatMessage(ctx, db.CreateTeamChatMessageParams{
		ChatSessionID: session.ID,
		Role:          "assistant",
		Content:       content,
	})
	if err != nil {
		slog.Warn("failed to create team system message", "team_id", util.UUIDToString(teamID), "error", err)
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventTeamMessageCreated,
		WorkspaceID: util.UUIDToString(session.WorkspaceID),
		ActorType:   "system",
		ActorID:     "",
		Payload:     teamMessageEventPayloadForSession(session, teamID, &message),
	})
}

func (s *TaskService) syncMissionTaskCompleted(ctx context.Context, task db.AgentTaskQueue, result []byte) {
	output := missionTaskOutput(result)
	if err := s.Queries.UpdateMissionAssignmentByTask(ctx, db.UpdateMissionAssignmentByTaskParams{
		TaskID: task.ID,
		Status: "completed",
		Output: pgtype.Text{String: output, Valid: strings.TrimSpace(output) != ""},
	}); err != nil {
		slog.Debug("mission assignment completion sync skipped", "task_id", util.UUIDToString(task.ID), "error", err)
		return
	}
	if err := s.Queries.UpdateMissionPlanItemByTask(ctx, db.UpdateMissionPlanItemByTaskParams{
		TaskID: task.ID,
		Status: "done",
	}); err != nil {
		slog.Debug("mission plan completion sync skipped", "task_id", util.UUIDToString(task.ID), "error", err)
	}
	if err := s.Queries.UpdateMissionByTask(ctx, db.UpdateMissionByTaskParams{
		TaskID: task.ID,
		Status: "executing",
	}); err != nil {
		slog.Debug("mission completion sync skipped", "task_id", util.UUIDToString(task.ID), "error", err)
	}
	if err := s.Queries.CreateMissionEventForTask(ctx, db.CreateMissionEventForTaskParams{
		TaskID:    task.ID,
		ActorType: "agent",
		ActorID:   task.AgentID,
		Kind:      "assignment_completed",
		Title:     "成员完成执行",
		Body:      truncateForSummary(output, triggerSummaryMaxLen),
		Payload: eventPayload(map[string]any{
			"task_id":  util.UUIDToString(task.ID),
			"agent_id": util.UUIDToString(task.AgentID),
		}),
	}); err != nil {
		slog.Debug("mission completion event skipped", "task_id", util.UUIDToString(task.ID), "error", err)
	}
	s.recordMissionAgentCompletion(ctx, task, output, false)
}

func (s *TaskService) syncMissionTaskFailed(ctx context.Context, task db.AgentTaskQueue, errMsg string) {
	body := strings.TrimSpace(errMsg)
	if body == "" {
		body = "成员执行失败，等待负责人或用户处理。"
	}
	if err := s.Queries.UpdateMissionAssignmentByTask(ctx, db.UpdateMissionAssignmentByTaskParams{
		TaskID: task.ID,
		Status: "failed",
		Output: pgtype.Text{String: body, Valid: true},
	}); err != nil {
		slog.Debug("mission assignment failure sync skipped", "task_id", util.UUIDToString(task.ID), "error", err)
		return
	}
	if err := s.Queries.UpdateMissionPlanItemByTask(ctx, db.UpdateMissionPlanItemByTaskParams{
		TaskID: task.ID,
		Status: "blocked",
	}); err != nil {
		slog.Debug("mission plan failure sync skipped", "task_id", util.UUIDToString(task.ID), "error", err)
	}
	if err := s.Queries.UpdateMissionByTask(ctx, db.UpdateMissionByTaskParams{
		TaskID: task.ID,
		Status: "blocked",
	}); err != nil {
		slog.Debug("mission failure sync skipped", "task_id", util.UUIDToString(task.ID), "error", err)
	}
	if err := s.Queries.CreateMissionEventForTask(ctx, db.CreateMissionEventForTaskParams{
		TaskID:    task.ID,
		ActorType: "agent",
		ActorID:   task.AgentID,
		Kind:      "assignment_failed",
		Title:     "成员执行受阻",
		Body:      truncateForSummary(body, triggerSummaryMaxLen),
		Payload: eventPayload(map[string]any{
			"task_id":  util.UUIDToString(task.ID),
			"agent_id": util.UUIDToString(task.AgentID),
		}),
	}); err != nil {
		slog.Debug("mission failure event skipped", "task_id", util.UUIDToString(task.ID), "error", err)
	}
	s.recordMissionAgentCompletion(ctx, task, body, true)
}

func (s *TaskService) recordMissionAgentCompletion(ctx context.Context, task db.AgentTaskQueue, body string, failed bool) {
	assignment, mission, ok := s.loadMissionAssignmentForTask(ctx, task.ID)
	if !ok {
		return
	}
	title := "Mission 子任务已完成"
	kind := "mission_assignment_completed"
	if failed {
		title = "Mission 子任务执行受阻"
		kind = "mission_assignment_failed"
	}
	payload := eventPayload(map[string]any{
		"mission_id":    util.UUIDToString(mission.ID),
		"assignment_id": util.UUIDToString(assignment.ID),
		"task_id":       util.UUIDToString(task.ID),
	})
	if _, err := s.Queries.CreateAgentEvent(ctx, db.CreateAgentEventParams{
		WorkspaceID: mission.WorkspaceID,
		AgentID:     task.AgentID,
		Kind:        kind,
		Title:       title,
		Body:        truncateForSummary(body, triggerSummaryMaxLen),
		Payload:     payload,
	}); err != nil {
		slog.Debug("mission agent event skipped", "task_id", util.UUIDToString(task.ID), "error", err)
	} else {
		s.publishAgentEvent(ctx, mission.WorkspaceID, task.AgentID)
	}
	if !failed && strings.TrimSpace(body) != "" {
		memory, err := s.Queries.CreateAgentMemory(ctx, db.CreateAgentMemoryParams{
			WorkspaceID: mission.WorkspaceID,
			AgentID:     task.AgentID,
			Kind:        "mission_reflection",
			Title:       "Mission 复盘候选：" + mission.Title,
			Body:        truncateForSummary(body, triggerSummaryMaxLen),
			RefType:     "mission_assignment",
			RefID:       assignment.ID,
			Status:      "candidate",
		})
		if err != nil {
			slog.Debug("mission reflection memory skipped", "task_id", util.UUIDToString(task.ID), "error", err)
		} else {
			s.publishAgentMemory(ctx, memory)
		}
		s.createSkillCandidatesFromContent(ctx, mission.WorkspaceID, task.AgentID, body, "mission_assignment", assignment.ID)
	}
	s.publishMissionUpdated(ctx, mission.WorkspaceID, mission.ID)
}

func (s *TaskService) loadMissionAssignmentForTask(ctx context.Context, taskID pgtype.UUID) (db.MissionAssignment, db.Mission, bool) {
	if !taskID.Valid {
		return db.MissionAssignment{}, db.Mission{}, false
	}
	mission, err := s.Queries.GetMissionByTask(ctx, taskID)
	if err != nil {
		return db.MissionAssignment{}, db.Mission{}, false
	}
	assignment, err := s.Queries.GetMissionAssignmentByTask(ctx, taskID)
	if err != nil {
		return db.MissionAssignment{}, db.Mission{}, false
	}
	return assignment, mission, true
}

func (s *TaskService) publishMissionUpdated(ctx context.Context, workspaceID, missionID pgtype.UUID) {
	if !workspaceID.Valid || !missionID.Valid || s.Bus == nil {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventMissionUpdated,
		WorkspaceID: util.UUIDToString(workspaceID),
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"mission_id": util.UUIDToString(missionID),
		},
	})
}

func missionTaskOutput(result []byte) string {
	var payload protocol.TaskCompletedPayload
	if err := json.Unmarshal(result, &payload); err == nil && strings.TrimSpace(payload.Output) != "" {
		return util.UnescapeBackslashEscapes(payload.Output)
	}
	return strings.TrimSpace(string(result))
}

func eventPayload(value map[string]any) []byte {
	payload, err := json.Marshal(value)
	if err != nil {
		return []byte("{}")
	}
	return payload
}

func (s *TaskService) extractTeamMemories(ctx context.Context, session db.ChatSession, team db.Team, agentID pgtype.UUID, message db.ChatMessage) {
	candidates := parseMemoryCandidates(message.Content)
	created := 0
	for _, candidate := range candidates {
		memory, err := s.Queries.CreateAgentMemory(ctx, db.CreateAgentMemoryParams{
			WorkspaceID: team.WorkspaceID,
			AgentID:     agentID,
			Kind:        candidate.Kind,
			Title:       candidate.Title,
			Body:        candidate.Body,
			RefType:     "team_message",
			RefID:       message.ID,
			Status:      "candidate",
		})
		if err != nil {
			slog.Warn("failed to create team memory",
				"team_id", util.UUIDToString(team.ID),
				"agent_id", util.UUIDToString(agentID),
				"kind", candidate.Kind,
				"error", err)
			continue
		}
		created++
		payload, _ := json.Marshal(map[string]any{
			"memory_id":       util.UUIDToString(memory.ID),
			"team_id":         util.UUIDToString(team.ID),
			"chat_session_id": util.UUIDToString(session.ID),
			"message_id":      util.UUIDToString(message.ID),
			"kind":            candidate.Kind,
		})
		if _, err := s.Queries.CreateAgentEvent(ctx, db.CreateAgentEventParams{
			WorkspaceID: team.WorkspaceID,
			AgentID:     agentID,
			Kind:        "memory_candidate_created",
			Title:       "生成了新的记忆候选",
			Body:        candidate.Title,
			Payload:     payload,
		}); err != nil {
			slog.Warn("failed to create memory event",
				"team_id", util.UUIDToString(team.ID),
				"agent_id", util.UUIDToString(agentID),
				"error", err)
		} else {
			s.publishAgentEvent(ctx, team.WorkspaceID, agentID)
		}
		s.publishAgentMemory(ctx, memory)
	}
	if created == 1 {
		s.createTeamSystemMessage(ctx, session, team.ID, "已生成 1 条智能体记忆候选，等待确认。")
	} else if created > 1 {
		s.createTeamSystemMessage(ctx, session, team.ID, fmt.Sprintf("已生成 %d 条智能体记忆候选，等待确认。", created))
	}

	skillCount := s.createSkillCandidatesFromContent(ctx, team.WorkspaceID, agentID, message.Content, "team_message", message.ID)
	if skillCount == 1 {
		s.createTeamSystemMessage(ctx, session, team.ID, "已生成 1 条技能候选，等待确认后沉淀到能力池。")
	} else if skillCount > 1 {
		s.createTeamSystemMessage(ctx, session, team.ID, fmt.Sprintf("已生成 %d 条技能候选，等待确认后沉淀到能力池。", skillCount))
	}
}

func (s *TaskService) createSkillCandidatesFromContent(ctx context.Context, workspaceID, agentID pgtype.UUID, content, refType string, refID pgtype.UUID) int {
	candidates := parseSkillCandidates(content)
	created := 0
	for _, candidate := range candidates {
		row, err := s.Queries.CreateAgentSkillCandidate(ctx, db.CreateAgentSkillCandidateParams{
			WorkspaceID: workspaceID,
			AgentID:     agentID,
			Name:        candidate.Name,
			Description: candidate.Description,
			Content:     candidate.Content,
			Config:      []byte("{}"),
			RefType:     refType,
			RefID:       refID,
			Status:      "candidate",
		})
		if err != nil {
			slog.Warn("failed to create skill candidate",
				"agent_id", util.UUIDToString(agentID),
				"name", candidate.Name,
				"error", err)
			continue
		}
		created++
		payload, _ := json.Marshal(map[string]any{
			"candidate_id": util.UUIDToString(row.ID),
			"ref_type":     refType,
			"ref_id":       util.UUIDToString(refID),
		})
		if _, err := s.Queries.CreateAgentEvent(ctx, db.CreateAgentEventParams{
			WorkspaceID: workspaceID,
			AgentID:     agentID,
			Kind:        "skill_candidate_created",
			Title:       "生成了新的技能候选",
			Body:        candidate.Name,
			Payload:     payload,
		}); err != nil {
			slog.Warn("failed to create skill candidate event",
				"agent_id", util.UUIDToString(agentID),
				"candidate_id", util.UUIDToString(row.ID),
				"error", err)
		} else {
			s.publishAgentEvent(ctx, workspaceID, agentID)
		}
		s.publishAgentSkillCandidate(ctx, row)
	}
	return created
}

func (s *TaskService) publishAgentMemory(ctx context.Context, memory db.AgentMemory) {
	s.Bus.Publish(events.Event{
		Type:        protocol.EventAgentMemoryCreated,
		WorkspaceID: util.UUIDToString(memory.WorkspaceID),
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"agent_id": util.UUIDToString(memory.AgentID),
			"memory": map[string]any{
				"id":                   util.UUIDToString(memory.ID),
				"workspace_id":         util.UUIDToString(memory.WorkspaceID),
				"agent_id":             util.UUIDToString(memory.AgentID),
				"kind":                 memory.Kind,
				"title":                memory.Title,
				"body":                 memory.Body,
				"ref_type":             memory.RefType,
				"ref_id":               util.UUIDToPtr(memory.RefID),
				"status":               memory.Status,
				"confirmed_at":         util.TimestampToPtr(memory.ConfirmedAt),
				"confirmed_by_user_id": util.UUIDToPtr(memory.ConfirmedByUserID),
				"created_at":           util.TimestampToString(memory.CreatedAt),
				"updated_at":           util.TimestampToString(memory.UpdatedAt),
			},
		},
	})
}

func (s *TaskService) publishAgentSkillCandidate(ctx context.Context, candidate db.AgentSkillCandidate) {
	s.Bus.Publish(events.Event{
		Type:        protocol.EventAgentSkillCandidateCreated,
		WorkspaceID: util.UUIDToString(candidate.WorkspaceID),
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"agent_id": util.UUIDToString(candidate.AgentID),
			"candidate": map[string]any{
				"id":                   util.UUIDToString(candidate.ID),
				"workspace_id":         util.UUIDToString(candidate.WorkspaceID),
				"agent_id":             util.UUIDToString(candidate.AgentID),
				"name":                 candidate.Name,
				"description":          candidate.Description,
				"content":              candidate.Content,
				"config":               json.RawMessage(candidate.Config),
				"ref_type":             candidate.RefType,
				"ref_id":               util.UUIDToPtr(candidate.RefID),
				"status":               candidate.Status,
				"skill_id":             util.UUIDToPtr(candidate.SkillID),
				"confirmed_at":         util.TimestampToPtr(candidate.ConfirmedAt),
				"confirmed_by_user_id": util.UUIDToPtr(candidate.ConfirmedByUserID),
				"created_at":           util.TimestampToString(candidate.CreatedAt),
				"updated_at":           util.TimestampToString(candidate.UpdatedAt),
			},
		},
	})
}

func (s *TaskService) publishAgentEvent(ctx context.Context, workspaceID, agentID pgtype.UUID) {
	s.Bus.Publish(events.Event{
		Type:        protocol.EventAgentEventCreated,
		WorkspaceID: util.UUIDToString(workspaceID),
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"agent_id": util.UUIDToString(agentID),
		},
	})
}

func mentionedTeamAgents(roster []teamRosterAgent, sourceAgentID pgtype.UUID, content string) []teamRosterAgent {
	tokens := extractAtTokens(content)
	if len(tokens) == 0 {
		return nil
	}
	all := false
	selected := map[string]teamRosterAgent{}
	for _, token := range tokens {
		if token == "全体" || strings.EqualFold(token, "all") || strings.EqualFold(token, "everyone") {
			all = true
			continue
		}
		for _, member := range roster {
			if uuidEqual(member.ID, sourceAgentID) {
				continue
			}
			if teamMentionMatches(token, member.Name) {
				selected[util.UUIDToString(member.ID)] = member
			}
		}
	}
	if all {
		for _, member := range roster {
			if uuidEqual(member.ID, sourceAgentID) {
				continue
			}
			selected[util.UUIDToString(member.ID)] = member
		}
	}
	if len(selected) == 0 {
		return nil
	}
	out := make([]teamRosterAgent, 0, len(selected))
	for _, member := range roster {
		if row, ok := selected[util.UUIDToString(member.ID)]; ok {
			out = append(out, row)
		}
	}
	return out
}

func extractAtTokens(content string) []string {
	rs := []rune(content)
	var tokens []string
	for i := 0; i < len(rs); i++ {
		if rs[i] != '@' {
			continue
		}
		j := i + 1
		for j < len(rs) {
			r := rs[j]
			if unicode.IsSpace(r) || strings.ContainsRune("，。,.!！?？:：;；()（）[]【】<>《》\"'“”‘’", r) {
				break
			}
			j++
		}
		token := strings.TrimSpace(string(rs[i+1 : j]))
		if token != "" {
			tokens = append(tokens, token)
		}
		i = j
	}
	return tokens
}

func teamMentionMatches(token, name string) bool {
	token = strings.TrimSpace(strings.ToLower(token))
	name = strings.TrimSpace(strings.ToLower(name))
	if token == "" || name == "" {
		return false
	}
	return token == name || strings.Contains(name, token) || strings.Contains(token, name)
}

func parseMemoryCandidates(content string) []memoryCandidate {
	lines := strings.Split(content, "\n")
	var out []memoryCandidate
	for _, line := range lines {
		line = strings.TrimSpace(strings.TrimLeft(line, "-*0123456789.、 "))
		if line == "" {
			continue
		}
		kind, body, ok := splitMemoryLine(line)
		if !ok {
			continue
		}
		body = strings.TrimSpace(body)
		if body == "" {
			continue
		}
		out = append(out, memoryCandidate{
			Kind:  kind,
			Title: memoryTitle(kind, body),
			Body:  body,
		})
	}
	return out
}

func parseSkillCandidates(content string) []skillCandidate {
	lines := strings.Split(content, "\n")
	var out []skillCandidate
	for _, line := range lines {
		line = strings.TrimSpace(strings.TrimLeft(line, "-*0123456789.、 "))
		if line == "" {
			continue
		}
		raw, ok := splitSkillLine(line)
		if !ok {
			continue
		}
		name, description := splitSkillNameDescription(raw)
		if name == "" {
			continue
		}
		out = append(out, skillCandidate{
			Name:        name,
			Description: description,
			Content:     skillCandidateContent(name, description),
		})
	}
	return out
}

func splitSkillLine(line string) (string, bool) {
	for _, prefix := range []string{"技能：", "技能:", "技能候选：", "技能候选:", "沉淀技能：", "沉淀技能:"} {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(line, prefix)), true
		}
	}
	return "", false
}

func splitSkillNameDescription(raw string) (string, string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}
	for _, sep := range []string{"——", " -- ", " - ", "：", ":"} {
		if idx := strings.Index(raw, sep); idx > 0 {
			name := strings.TrimSpace(raw[:idx])
			description := strings.TrimSpace(raw[idx+len(sep):])
			return truncateForSummary(name, 80), description
		}
	}
	return truncateForSummary(raw, 80), ""
}

func skillCandidateContent(name, description string) string {
	if strings.TrimSpace(description) == "" {
		return "## 使用场景\n\n" + name + "\n"
	}
	return "## 使用场景\n\n" + description + "\n"
}

func splitMemoryLine(line string) (string, string, bool) {
	prefixes := []struct {
		prefix string
		kind   string
	}{
		{"决策：", "decision"},
		{"决策:", "decision"},
		{"记住：", "preference"},
		{"记住:", "preference"},
		{"偏好：", "preference"},
		{"偏好:", "preference"},
		{"项目知识：", "project"},
		{"项目知识:", "project"},
		{"知识：", "project"},
		{"知识:", "project"},
		{"问题：", "problem"},
		{"问题:", "problem"},
		{"踩坑：", "problem"},
		{"踩坑:", "problem"},
	}
	for _, p := range prefixes {
		if strings.HasPrefix(line, p.prefix) {
			return p.kind, strings.TrimPrefix(line, p.prefix), true
		}
	}
	return "", "", false
}

func memoryTitle(kind, body string) string {
	prefix := map[string]string{
		"decision":   "重要决策",
		"preference": "用户偏好",
		"project":    "项目知识",
		"problem":    "最近问题",
	}[kind]
	if prefix == "" {
		prefix = "团队记忆"
	}
	summary := truncateForSummary(body, 36)
	if summary == "" {
		return prefix
	}
	return prefix + "：" + summary
}

func uuidEqual(a, b pgtype.UUID) bool {
	return a.Valid && b.Valid && a.Bytes == b.Bytes
}

func (s *TaskService) broadcastIssueUpdated(issue db.Issue) {
	prefix := s.getIssuePrefix(issue.WorkspaceID)
	s.Bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: util.UUIDToString(issue.WorkspaceID),
		ActorType:   "system",
		ActorID:     "",
		Payload:     map[string]any{"issue": issueToMap(issue, prefix)},
	})
}

func (s *TaskService) getIssuePrefix(workspaceID pgtype.UUID) string {
	ws, err := s.Queries.GetWorkspace(context.Background(), workspaceID)
	if err != nil {
		return ""
	}
	return ws.IssuePrefix
}

func (s *TaskService) createAgentComment(ctx context.Context, issueID, agentID pgtype.UUID, content, commentType string, parentID pgtype.UUID) {
	if content == "" {
		return
	}
	// Look up issue to get workspace ID for mention expansion and broadcasting.
	issue, err := s.Queries.GetIssue(ctx, issueID)
	if err != nil {
		return
	}
	// Resolve thread root: if parentID points to a reply (has its own parent),
	// use that parent instead so the comment lands in the top-level thread.
	if parentID.Valid {
		if parent, err := s.Queries.GetComment(ctx, parentID); err == nil && parent.ParentID.Valid {
			parentID = parent.ParentID
		}
	}
	// Expand bare issue identifiers (e.g. MUL-117) into mention links.
	content = mention.ExpandIssueIdentifiers(ctx, s.Queries, issue.WorkspaceID, content)
	comment, err := s.Queries.CreateComment(ctx, db.CreateCommentParams{
		IssueID:     issueID,
		WorkspaceID: issue.WorkspaceID,
		AuthorType:  "agent",
		AuthorID:    agentID,
		Content:     content,
		Type:        commentType,
		ParentID:    parentID,
	})
	if err != nil {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventCommentCreated,
		WorkspaceID: util.UUIDToString(issue.WorkspaceID),
		ActorType:   "agent",
		ActorID:     util.UUIDToString(agentID),
		Payload: addIssueSourceFields(map[string]any{
			"comment": map[string]any{
				"id":          util.UUIDToString(comment.ID),
				"issue_id":    util.UUIDToString(comment.IssueID),
				"author_type": comment.AuthorType,
				"author_id":   util.UUIDToString(comment.AuthorID),
				"content":     comment.Content,
				"type":        comment.Type,
				"parent_id":   util.UUIDToPtr(comment.ParentID),
				"created_at":  comment.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
			},
			"issue_title":  issue.Title,
			"issue_status": issue.Status,
		}, issue),
	})
}

func addIssueSourceFields(payload map[string]any, issue db.Issue) map[string]any {
	if issue.SourceTeamMessageID.Valid {
		payload["source_team_message_id"] = util.UUIDToString(issue.SourceTeamMessageID)
	}
	if issue.SourceTeamSessionID.Valid {
		payload["source_team_session_id"] = util.UUIDToString(issue.SourceTeamSessionID)
	}
	return payload
}

func issueToMap(issue db.Issue, issuePrefix string) map[string]any {
	return map[string]any{
		"id":                     util.UUIDToString(issue.ID),
		"workspace_id":           util.UUIDToString(issue.WorkspaceID),
		"number":                 issue.Number,
		"identifier":             issuePrefix + "-" + strconv.Itoa(int(issue.Number)),
		"title":                  issue.Title,
		"description":            util.TextToPtr(issue.Description),
		"status":                 issue.Status,
		"priority":               issue.Priority,
		"assignee_type":          util.TextToPtr(issue.AssigneeType),
		"assignee_id":            util.UUIDToPtr(issue.AssigneeID),
		"creator_type":           issue.CreatorType,
		"creator_id":             util.UUIDToString(issue.CreatorID),
		"parent_issue_id":        util.UUIDToPtr(issue.ParentIssueID),
		"project_id":             util.UUIDToPtr(issue.ProjectID),
		"position":               issue.Position,
		"due_date":               util.TimestampToPtr(issue.DueDate),
		"source_team_message_id": util.UUIDToPtr(issue.SourceTeamMessageID),
		"source_team_session_id": util.UUIDToPtr(issue.SourceTeamSessionID),
		"created_at":             util.TimestampToString(issue.CreatedAt),
		"updated_at":             util.TimestampToString(issue.UpdatedAt),
	}
}

// parseQuickCreateContext returns the quick-create payload if the task's
// context JSONB contains type == "quick_create"; otherwise the bool is
// false so callers can short-circuit. Tasks linked to an issue / chat /
// autopilot are never quick-create even if they happen to carry a
// context blob, so those are filtered up front.
func (s *TaskService) parseQuickCreateContext(task db.AgentTaskQueue) (QuickCreateContext, bool) {
	if task.IssueID.Valid || task.ChatSessionID.Valid || task.AutopilotRunID.Valid {
		return QuickCreateContext{}, false
	}
	if len(task.Context) == 0 {
		return QuickCreateContext{}, false
	}
	var qc QuickCreateContext
	if err := json.Unmarshal(task.Context, &qc); err != nil {
		return QuickCreateContext{}, false
	}
	if qc.Type != QuickCreateContextType {
		return QuickCreateContext{}, false
	}
	return qc, true
}

// parseProjectCompactionContext returns the compaction payload if the task's
// context JSONB contains type == "project_compaction"; otherwise false.
func (s *TaskService) parseProjectCompactionContext(task db.AgentTaskQueue) (ProjectCompactionContext, bool) {
	if task.IssueID.Valid || task.ChatSessionID.Valid || task.AutopilotRunID.Valid {
		return ProjectCompactionContext{}, false
	}
	if len(task.Context) == 0 {
		return ProjectCompactionContext{}, false
	}
	var pc ProjectCompactionContext
	if err := json.Unmarshal(task.Context, &pc); err != nil {
		return ProjectCompactionContext{}, false
	}
	if pc.Type != ProjectCompactionContextType {
		return ProjectCompactionContext{}, false
	}
	return pc, true
}

// notifyQuickCreateCompleted writes a success inbox notification to the
// requester pointing at the issue the agent just created. The issue is
// stamped with origin_type=quick_create + origin_id=<task_id> by the
// daemon-injected MULTICA_QUICK_CREATE_TASK_ID env var, so this lookup is
// deterministic — robust against the same agent creating other issues in
// parallel (e.g. assignment task running while max_concurrent_tasks > 1
// permits another quick-create alongside it).
func (s *TaskService) notifyQuickCreateCompleted(ctx context.Context, task db.AgentTaskQueue, qc QuickCreateContext) {
	requesterID, err := util.ParseUUID(qc.RequesterID)
	if err != nil {
		slog.Warn("quick-create completion: invalid requester id", "task_id", util.UUIDToString(task.ID), "error", err)
		return
	}
	workspaceID, err := util.ParseUUID(qc.WorkspaceID)
	if err != nil {
		slog.Warn("quick-create completion: invalid workspace id", "task_id", util.UUIDToString(task.ID), "error", err)
		return
	}
	issue, err := s.Queries.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
		WorkspaceID: workspaceID,
		OriginType:  pgtype.Text{String: "quick_create", Valid: true},
		OriginID:    task.ID,
	})
	if err != nil {
		// No issue created — agent ran to completion but the CLI call must
		// have failed. Surface as a failure inbox so the user sees something.
		slog.Warn("quick-create completion: no issue found, writing failure inbox",
			"task_id", util.UUIDToString(task.ID),
			"agent_id", util.UUIDToString(task.AgentID),
			"workspace_id", qc.WorkspaceID,
		)
		s.notifyQuickCreateFailed(ctx, task, qc, "agent finished without creating an issue")
		return
	}

	// Link the new issue back to this task so subsequent reads of the task
	// (Activity tab, Recent work, etc.) render it as a normal issue task
	// (kind = "direct") instead of staying on the "Creating issue" active-
	// wording label. Best-effort: a write failure here doesn't block the
	// inbox notification, which is the more important signal to the user.
	if err := s.Queries.LinkTaskToIssue(ctx, db.LinkTaskToIssueParams{
		ID:      task.ID,
		IssueID: issue.ID,
	}); err != nil {
		slog.Warn("quick-create completion: link task→issue failed",
			"task_id", util.UUIDToString(task.ID),
			"issue_id", util.UUIDToString(issue.ID),
			"error", err,
		)
	}

	// Subscribe the requester so they receive notifications for follow-up
	// comments and updates. The DB row's creator_type/creator_id is the
	// agent (it ran the CLI), but the human who triggered the quick-create
	// is the semantic creator from a UX perspective — without this they
	// only see the one-shot completion inbox and miss everything after.
	// Best-effort: log on failure but don't block the inbox notification.
	if err := s.Queries.AddIssueSubscriber(ctx, db.AddIssueSubscriberParams{
		IssueID:  issue.ID,
		UserType: "member",
		UserID:   requesterID,
		Reason:   "creator",
	}); err != nil {
		slog.Warn("quick-create completion: subscribe requester failed",
			"task_id", util.UUIDToString(task.ID),
			"issue_id", util.UUIDToString(issue.ID),
			"requester_id", qc.RequesterID,
			"error", err,
		)
	} else {
		s.Bus.Publish(events.Event{
			Type:        protocol.EventSubscriberAdded,
			WorkspaceID: qc.WorkspaceID,
			ActorType:   "agent",
			ActorID:     util.UUIDToString(task.AgentID),
			Payload: map[string]any{
				"issue_id":  util.UUIDToString(issue.ID),
				"user_type": "member",
				"user_id":   qc.RequesterID,
				"reason":    "creator",
			},
		})
	}
	prefix := s.getIssuePrefix(workspaceID)
	identifier := fmt.Sprintf("%s-%d", prefix, issue.Number)
	details, _ := json.Marshal(map[string]any{
		"task_id":         util.UUIDToString(task.ID),
		"agent_id":        util.UUIDToString(task.AgentID),
		"issue_id":        util.UUIDToString(issue.ID),
		"identifier":      identifier,
		"original_prompt": qc.Prompt,
	})
	item, err := s.Queries.CreateInboxItem(ctx, db.CreateInboxItemParams{
		WorkspaceID:   workspaceID,
		RecipientType: "member",
		RecipientID:   requesterID,
		Type:          "quick_create_done",
		Severity:      "info",
		IssueID:       issue.ID,
		Title:         issue.Title,
		Body:          pgtype.Text{},
		ActorType:     pgtype.Text{String: "agent", Valid: true},
		ActorID:       task.AgentID,
		Details:       details,
	})
	if err != nil {
		slog.Error("quick-create completion: inbox write failed", "task_id", util.UUIDToString(task.ID), "error", err)
		return
	}
	s.publishQuickCreateInbox(item, qc.WorkspaceID, util.UUIDToString(task.AgentID), issue.Status)
}

// notifyQuickCreateFailed writes a failure inbox notification carrying the
// original prompt + agent ID so the frontend can render an "Edit as
// advanced form" entry that pre-fills the legacy create-issue modal
// without asking the user to retype.
func (s *TaskService) notifyQuickCreateFailed(ctx context.Context, task db.AgentTaskQueue, qc QuickCreateContext, errMsg string) {
	requesterID, err := util.ParseUUID(qc.RequesterID)
	if err != nil {
		return
	}
	workspaceID, err := util.ParseUUID(qc.WorkspaceID)
	if err != nil {
		return
	}
	if errMsg == "" {
		errMsg = "Quick create did not finish successfully"
	}
	details, _ := json.Marshal(map[string]any{
		"task_id":         util.UUIDToString(task.ID),
		"agent_id":        util.UUIDToString(task.AgentID),
		"original_prompt": qc.Prompt,
		"error":           redact.Text(errMsg),
	})
	item, err := s.Queries.CreateInboxItem(ctx, db.CreateInboxItemParams{
		WorkspaceID:   workspaceID,
		RecipientType: "member",
		RecipientID:   requesterID,
		Type:          "quick_create_failed",
		Severity:      "action_required",
		IssueID:       pgtype.UUID{},
		Title:         "Quick create failed",
		Body:          pgtype.Text{String: redact.Text(errMsg), Valid: true},
		ActorType:     pgtype.Text{String: "agent", Valid: true},
		ActorID:       task.AgentID,
		Details:       details,
	})
	if err != nil {
		slog.Error("quick-create failure: inbox write failed", "task_id", util.UUIDToString(task.ID), "error", err)
		return
	}
	s.publishQuickCreateInbox(item, qc.WorkspaceID, util.UUIDToString(task.AgentID), "")
}

// publishQuickCreateInbox emits the WS event so the requester's inbox list
// updates immediately. Mirrors the payload shape used by the other inbox
// listeners (notification_listeners.go).
func (s *TaskService) publishQuickCreateInbox(item db.InboxItem, workspaceID, agentID, issueStatus string) {
	resp := map[string]any{
		"id":             util.UUIDToString(item.ID),
		"workspace_id":   util.UUIDToString(item.WorkspaceID),
		"recipient_type": item.RecipientType,
		"recipient_id":   util.UUIDToString(item.RecipientID),
		"type":           item.Type,
		"severity":       item.Severity,
		"issue_id":       util.UUIDToPtr(item.IssueID),
		"title":          item.Title,
		"body":           util.TextToPtr(item.Body),
		"read":           item.Read,
		"archived":       item.Archived,
		"created_at":     util.TimestampToString(item.CreatedAt),
		"actor_type":     util.TextToPtr(item.ActorType),
		"actor_id":       util.UUIDToPtr(item.ActorID),
		"details":        json.RawMessage(item.Details),
		"issue_status":   issueStatus,
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventInboxNew,
		WorkspaceID: workspaceID,
		ActorType:   "agent",
		ActorID:     agentID,
		Payload:     map[string]any{"item": resp},
	})
}

// agentToMap builds a simple map for broadcasting agent status updates.
func agentToMap(a db.Agent) map[string]any {
	var rc any
	if a.RuntimeConfig != nil {
		json.Unmarshal(a.RuntimeConfig, &rc)
	}
	return map[string]any{
		"id":                   util.UUIDToString(a.ID),
		"workspace_id":         util.UUIDToString(a.WorkspaceID),
		"runtime_id":           util.UUIDToString(a.RuntimeID),
		"name":                 a.Name,
		"description":          a.Description,
		"avatar_url":           util.TextToPtr(a.AvatarUrl),
		"runtime_mode":         a.RuntimeMode,
		"runtime_config":       rc,
		"visibility":           a.Visibility,
		"status":               a.Status,
		"max_concurrent_tasks": a.MaxConcurrentTasks,
		"owner_id":             util.UUIDToPtr(a.OwnerID),
		"skills":               []any{},
		"created_at":           util.TimestampToString(a.CreatedAt),
		"updated_at":           util.TimestampToString(a.UpdatedAt),
		"archived_at":          util.TimestampToPtr(a.ArchivedAt),
		"archived_by":          util.UUIDToPtr(a.ArchivedBy),
	}
}
