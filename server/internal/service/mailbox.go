package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// Mailbox dispatch (PRD §14.8 — Agent work mode = mailbox)
//
// The desktop dispatch path is shared between live and mailbox modes —
// agent_task_queue is already async, so the work itself runs the same way.
// What differs is the user-facing surface:
//
//   live    — chat window blocks waiting for the assistant bubble.
//   mailbox — chat window confirms "received, processing" and lets the
//             user leave; result/blocked-reason surface back through
//             mailbox_item rows and workbench block 6.
//
// We keep that surface in this file so task.go stays focused on the queue
// invariants. Every helper here is best-effort: failures must NOT roll back
// the underlying task creation/completion, only log a warn — losing a
// mailbox row is recoverable, losing a task is not.

// recordMailboxSubmissionIfNeeded inserts a mailbox_item row + a "received,
// processing" system message into the chat session when the agent runs in
// mailbox mode. Live-mode agents are no-ops.
//
// Called from EnqueueChatTaskForAgent right after the chat task lands in
// agent_task_queue. Errors are logged and swallowed: the task itself is
// already committed and the daemon will pick it up regardless.
func (s *TaskService) recordMailboxSubmissionIfNeeded(
	ctx context.Context,
	agent db.Agent,
	chatSession db.ChatSession,
	task db.AgentTaskQueue,
) {
	if agent.WorkMode != "mailbox" {
		return
	}

	// Pull the user's prompt from the just-stored chat_message so block 6
	// can show what the agent is working on. Empty fallback is fine: the
	// user can still find the message via chat_session_id.
	rawUserMessage := ""
	if msg, err := s.Queries.GetLatestUserChatMessage(ctx, chatSession.ID); err == nil {
		rawUserMessage = msg.Content
	} else {
		slog.Warn("mailbox submission: failed to read latest user message",
			"chat_session_id", util.UUIDToString(chatSession.ID),
			"task_id", util.UUIDToString(task.ID),
			"error", err,
		)
	}

	item, err := s.Queries.CreateMailboxItem(ctx, db.CreateMailboxItemParams{
		WorkspaceID:    agent.WorkspaceID,
		AgentID:        agent.ID,
		ChatSessionID:  chatSession.ID,
		TaskID:         pgtype.UUID{Bytes: task.ID.Bytes, Valid: true},
		RawUserMessage: rawUserMessage,
	})
	if err != nil {
		slog.Warn("mailbox submission: failed to create mailbox item",
			"chat_session_id", util.UUIDToString(chatSession.ID),
			"task_id", util.UUIDToString(task.ID),
			"agent_id", util.UUIDToString(agent.ID),
			"error", err,
		)
		return
	}

	// Drop a system message in the chat so the user sees an immediate
	// confirmation when they reopen the conversation. Visual differentiation
	// (mailbox icon, distinct row style) lives in the renderer — this is
	// just the durable transcript entry.
	confirmation := mailboxConfirmationText(agent, rawUserMessage)
	if _, err := s.Queries.CreateChatMessage(ctx, db.CreateChatMessageParams{
		ChatSessionID: chatSession.ID,
		Role:          "system",
		Content:       confirmation,
		TaskID:        pgtype.UUID{Bytes: task.ID.Bytes, Valid: true},
	}); err != nil {
		slog.Warn("mailbox submission: failed to write confirmation message",
			"chat_session_id", util.UUIDToString(chatSession.ID),
			"task_id", util.UUIDToString(task.ID),
			"error", err,
		)
	}

	s.broadcastMailboxEvent(protocol.EventMailboxItemCreated, item)
}

// markMailboxItemForTask flips the mailbox_item bound to the given task to
// the supplied terminal state. No-op when the task has no mailbox row
// (live-mode tasks). Errors are logged and swallowed: chat completion is the
// source of truth, mailbox is a derived view.
func (s *TaskService) markMailboxItemForTask(
	ctx context.Context,
	task db.AgentTaskQueue,
	status string,
	resultText string,
	blockedDesc string,
) {
	if !task.ChatSessionID.Valid {
		return
	}
	item, err := s.Queries.GetMailboxItemByTask(ctx, pgtype.UUID{Bytes: task.ID.Bytes, Valid: true})
	if err != nil {
		// Most chat tasks won't have a mailbox row (live-mode agents).
		// pgx.ErrNoRows is the common case; only log other errors.
		return
	}

	var updated db.MailboxItem
	switch status {
	case "done":
		updated, err = s.Queries.MarkMailboxItemDone(ctx, db.MarkMailboxItemDoneParams{
			ID:     item.ID,
			Result: resultText,
		})
	case "blocked":
		updated, err = s.Queries.MarkMailboxItemBlocked(ctx, db.MarkMailboxItemBlockedParams{
			ID:                 item.ID,
			BlockedDescription: blockedDesc,
		})
	case "timeout":
		updated, err = s.Queries.MarkMailboxItemTimeout(ctx, db.MarkMailboxItemTimeoutParams{
			ID:                 item.ID,
			BlockedDescription: blockedDesc,
		})
	default:
		slog.Warn("markMailboxItemForTask: unknown status",
			"task_id", util.UUIDToString(task.ID),
			"status", status,
		)
		return
	}
	if err != nil {
		slog.Warn("markMailboxItemForTask: update failed",
			"task_id", util.UUIDToString(task.ID),
			"mailbox_item_id", util.UUIDToString(item.ID),
			"target_status", status,
			"error", err,
		)
		return
	}
	s.broadcastMailboxEvent(protocol.EventMailboxItemUpdated, updated)
}

// markMailboxItemDoneFromResult is the convenience wrapper used by
// CompleteTask — extracts the assistant Output from the daemon's result
// payload (same shape used to write the chat assistant message) and writes
// it as the mailbox result text. Falls back to the raw bytes if the payload
// can't be unmarshalled, which keeps the mailbox row useful even when the
// daemon emits a non-standard result.
func (s *TaskService) markMailboxItemDoneFromResult(
	ctx context.Context,
	task db.AgentTaskQueue,
	resultBytes []byte,
) {
	resultText := ""
	if len(resultBytes) > 0 {
		var payload protocol.TaskCompletedPayload
		if err := json.Unmarshal(resultBytes, &payload); err == nil {
			resultText = payload.Output
		} else {
			resultText = string(resultBytes)
		}
	}
	s.markMailboxItemForTask(ctx, task, "done", resultText, "")
}

// mailboxConfirmationText builds the system-message body shown in the chat
// transcript when a mailbox-mode task is enqueued. Kept short and human-
// readable; richer status comes from block 6 / the agent detail view.
func mailboxConfirmationText(agent db.Agent, rawUserMessage string) string {
	var b strings.Builder
	b.WriteString("已收到，「")
	b.WriteString(agent.Name)
	b.WriteString("」正在后台处理")
	if agent.MailboxBudgetSeconds > 0 {
		b.WriteString("（处理预算约 ")
		b.WriteString(formatBudget(agent.MailboxBudgetSeconds))
		b.WriteString("）")
	}
	b.WriteString("。完成或卡点会回报到信箱回报区与本对话。")
	return b.String()
}

func formatBudget(seconds int32) string {
	if seconds >= 3600 {
		hours := seconds / 3600
		minutes := (seconds % 3600) / 60
		if minutes == 0 {
			return budgetHoursLabel(hours)
		}
		return budgetHoursLabel(hours) + budgetMinutesLabel(minutes)
	}
	minutes := seconds / 60
	if minutes < 1 {
		minutes = 1
	}
	return budgetMinutesLabel(minutes)
}

func budgetHoursLabel(h int32) string {
	if h == 1 {
		return "1 小时"
	}
	return fmt.Sprintf("%d 小时", h)
}

func budgetMinutesLabel(m int32) string {
	return fmt.Sprintf("%d 分钟", m)
}

func (s *TaskService) broadcastMailboxEvent(eventType string, item db.MailboxItem) {
	s.Bus.Publish(events.Event{
		Type:        eventType,
		WorkspaceID: util.UUIDToString(item.WorkspaceID),
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"item": map[string]any{
				"id":                     util.UUIDToString(item.ID),
				"workspace_id":           util.UUIDToString(item.WorkspaceID),
				"agent_id":               util.UUIDToString(item.AgentID),
				"chat_session_id":        util.UUIDToString(item.ChatSessionID),
				"task_id":                util.UUIDToString(item.TaskID),
				"raw_user_message":       item.RawUserMessage,
				"status":                 item.Status,
				"result":                 item.Result,
				"blocked_description":    item.BlockedDescription,
				"submitted_at":           util.TimestampToString(item.SubmittedAt),
				"processing_started_at":  util.TimestampToString(item.ProcessingStartedAt),
				"processing_finished_at": util.TimestampToString(item.ProcessingFinishedAt),
				"created_at":             util.TimestampToString(item.CreatedAt),
				"updated_at":             util.TimestampToString(item.UpdatedAt),
			},
		},
	})
}
