package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// =====================
// Response types
// =====================

// MailboxItemResponse is the user-facing report row that backs workbench
// block 6 ("信箱回报") and the agent detail page. It is created/updated by
// the chat dispatch path (service/task.go) — there is no public CreateMailbox
// endpoint, the rows are derived from real chat traffic.
type MailboxItemResponse struct {
	ID                   string  `json:"id"`
	WorkspaceID          string  `json:"workspace_id"`
	AgentID              string  `json:"agent_id"`
	ChatSessionID        string  `json:"chat_session_id"`
	TaskID               *string `json:"task_id"`
	RawUserMessage       string  `json:"raw_user_message"`
	Status               string  `json:"status"`
	Result               string  `json:"result"`
	BlockedDescription   string  `json:"blocked_description"`
	SubmittedAt          string  `json:"submitted_at"`
	ProcessingStartedAt  *string `json:"processing_started_at"`
	ProcessingFinishedAt *string `json:"processing_finished_at"`
	CreatedAt            string  `json:"created_at"`
	UpdatedAt            string  `json:"updated_at"`
}

type ListMailboxItemsResponse struct {
	Items []MailboxItemResponse `json:"items"`
	Total int                   `json:"total"`
}

// =====================
// Converters
// =====================

func mailboxItemToResponse(m db.MailboxItem) MailboxItemResponse {
	var processingStarted, processingFinished *string
	if m.ProcessingStartedAt.Valid {
		v := timestampToString(m.ProcessingStartedAt)
		processingStarted = &v
	}
	if m.ProcessingFinishedAt.Valid {
		v := timestampToString(m.ProcessingFinishedAt)
		processingFinished = &v
	}
	return MailboxItemResponse{
		ID:                   uuidToString(m.ID),
		WorkspaceID:          uuidToString(m.WorkspaceID),
		AgentID:              uuidToString(m.AgentID),
		ChatSessionID:        uuidToString(m.ChatSessionID),
		TaskID:               uuidToPtr(m.TaskID),
		RawUserMessage:       m.RawUserMessage,
		Status:               m.Status,
		Result:               m.Result,
		BlockedDescription:   m.BlockedDescription,
		SubmittedAt:          timestampToString(m.SubmittedAt),
		ProcessingStartedAt:  processingStarted,
		ProcessingFinishedAt: processingFinished,
		CreatedAt:            timestampToString(m.CreatedAt),
		UpdatedAt:            timestampToString(m.UpdatedAt),
	}
}

// =====================
// Handlers
// =====================

// ListMailboxItems backs workbench block 6 and the agent detail mailbox tab.
// Default scope is the caller's workspace, ordered by most-recently-finished.
// Optional ?agent_id= filter narrows to one agent (validated cross-workspace).
func (h *Handler) ListMailboxItems(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	limit, offset := parseLimitOffset(r, 20, 0)

	q := r.URL.Query()
	agentFilter := strings.TrimSpace(q.Get("agent_id"))

	var rows []db.MailboxItem
	var err error
	if agentFilter != "" {
		agentUUID, ok := h.resolveAgentInWorkspace(w, r, agentFilter, "agent_id", wsUUID)
		if !ok {
			return
		}
		rows, err = h.Queries.ListMailboxItemsByAgent(r.Context(), db.ListMailboxItemsByAgentParams{
			AgentID: agentUUID,
			Limit:   int32(limit),
			Offset:  int32(offset),
		})
	} else {
		rows, err = h.Queries.ListMailboxItemsByWorkspace(r.Context(), db.ListMailboxItemsByWorkspaceParams{
			WorkspaceID: wsUUID,
			Limit:       int32(limit),
			Offset:      int32(offset),
		})
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list mailbox items")
		return
	}
	resp := make([]MailboxItemResponse, len(rows))
	for i, m := range rows {
		resp[i] = mailboxItemToResponse(m)
	}
	writeJSON(w, http.StatusOK, ListMailboxItemsResponse{Items: resp, Total: len(resp)})
}

// GetMailboxItem returns a single mailbox row, scoped to the caller's
// workspace.
func (h *Handler) GetMailboxItem(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	itemUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "mailbox item id")
	if !ok {
		return
	}
	item, err := h.Queries.GetMailboxItem(r.Context(), itemUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "mailbox item not found")
		return
	}
	if !uuidEqual(item.WorkspaceID, wsUUID) {
		// Cross-workspace probe — pretend it doesn't exist instead of
		// confirming the id is real.
		writeError(w, http.StatusNotFound, "mailbox item not found")
		return
	}
	writeJSON(w, http.StatusOK, mailboxItemToResponse(item))
}

// =====================
// Helpers
// =====================

func parseLimitOffset(r *http.Request, defaultLimit, defaultOffset int) (int, int) {
	limit := defaultLimit
	offset := defaultOffset
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}
	if v := strings.TrimSpace(r.URL.Query().Get("offset")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed >= 0 {
			offset = parsed
		}
	}
	return limit, offset
}

func uuidEqual(a, b pgtype.UUID) bool {
	if !a.Valid || !b.Valid {
		return false
	}
	return a.Bytes == b.Bytes
}
