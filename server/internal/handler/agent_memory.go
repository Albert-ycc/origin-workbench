package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type AgentMemoryResponse struct {
	ID                string  `json:"id"`
	WorkspaceID       string  `json:"workspace_id"`
	AgentID           string  `json:"agent_id"`
	Kind              string  `json:"kind"`
	Title             string  `json:"title"`
	Body              string  `json:"body"`
	RefType           string  `json:"ref_type"`
	RefID             *string `json:"ref_id"`
	Status            string  `json:"status"`
	ConfirmedAt       *string `json:"confirmed_at"`
	ConfirmedByUserID *string `json:"confirmed_by_user_id"`
	CreatedAt         string  `json:"created_at"`
	UpdatedAt         string  `json:"updated_at"`
}

type AgentEventResponse struct {
	ID          string          `json:"id"`
	WorkspaceID string          `json:"workspace_id"`
	AgentID     string          `json:"agent_id"`
	Kind        string          `json:"kind"`
	Title       string          `json:"title"`
	Body        string          `json:"body"`
	Payload     json.RawMessage `json:"payload"`
	CreatedAt   string          `json:"created_at"`
}

type CreateAgentMemoryRequest struct {
	Kind    string  `json:"kind"`
	Title   string  `json:"title"`
	Body    string  `json:"body"`
	RefType string  `json:"ref_type"`
	RefID   *string `json:"ref_id"`
	Status  string  `json:"status"`
}

func agentMemoryToResponse(row db.AgentMemory) AgentMemoryResponse {
	return AgentMemoryResponse{
		ID:                uuidToString(row.ID),
		WorkspaceID:       uuidToString(row.WorkspaceID),
		AgentID:           uuidToString(row.AgentID),
		Kind:              row.Kind,
		Title:             row.Title,
		Body:              row.Body,
		RefType:           row.RefType,
		RefID:             uuidToPtr(row.RefID),
		Status:            row.Status,
		ConfirmedAt:       timestampToPtr(row.ConfirmedAt),
		ConfirmedByUserID: uuidToPtr(row.ConfirmedByUserID),
		CreatedAt:         timestampToString(row.CreatedAt),
		UpdatedAt:         timestampToString(row.UpdatedAt),
	}
}

func agentEventToResponse(row db.AgentEvent) AgentEventResponse {
	payload := json.RawMessage(row.Payload)
	if len(payload) == 0 {
		payload = json.RawMessage("{}")
	}
	return AgentEventResponse{
		ID:          uuidToString(row.ID),
		WorkspaceID: uuidToString(row.WorkspaceID),
		AgentID:     uuidToString(row.AgentID),
		Kind:        row.Kind,
		Title:       row.Title,
		Body:        row.Body,
		Payload:     payload,
		CreatedAt:   timestampToString(row.CreatedAt),
	}
}

func parseLimitQuery(r *http.Request, fallback, max int32) int32 {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	if int32(n) > max {
		return max
	}
	return int32(n)
}

func normalizeMemoryStatus(raw string) string {
	switch raw {
	case "candidate", "rejected":
		return raw
	default:
		return "confirmed"
	}
}

func memoryStatusesFromQuery(r *http.Request) []string {
	switch r.URL.Query().Get("status") {
	case "candidate":
		return []string{"candidate"}
	case "confirmed":
		return []string{"confirmed"}
	case "rejected":
		return []string{"rejected"}
	case "all":
		return []string{"candidate", "confirmed", "rejected"}
	default:
		return []string{"candidate", "confirmed"}
	}
}

func (h *Handler) ListAgentMemories(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	agent, ok := h.loadAgentForUser(w, r, agentID)
	if !ok {
		return
	}
	if uuidToString(agent.WorkspaceID) != workspaceID {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}

	rows, err := h.Queries.ListAgentMemories(r.Context(), db.ListAgentMemoriesParams{
		WorkspaceID: agent.WorkspaceID,
		AgentID:     agent.ID,
		Limit:       parseLimitQuery(r, 20, 100),
		Statuses:    memoryStatusesFromQuery(r),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agent memories")
		return
	}
	resp := make([]AgentMemoryResponse, len(rows))
	for i, row := range rows {
		resp[i] = agentMemoryToResponse(row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"memories": resp})
}

func (h *Handler) CreateAgentMemory(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	agent, ok := h.loadAgentForUser(w, r, agentID)
	if !ok {
		return
	}
	if uuidToString(agent.WorkspaceID) != workspaceID {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}

	var req CreateAgentMemoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Kind == "" || req.Title == "" {
		writeError(w, http.StatusBadRequest, "kind and title are required")
		return
	}
	var refID pgtype.UUID
	if req.RefID != nil && *req.RefID != "" {
		parsed, ok := parseUUIDOrBadRequest(w, *req.RefID, "ref_id")
		if !ok {
			return
		}
		refID = parsed
	}
	row, err := h.Queries.CreateAgentMemory(r.Context(), db.CreateAgentMemoryParams{
		WorkspaceID:       agent.WorkspaceID,
		AgentID:           agent.ID,
		Kind:              req.Kind,
		Title:             req.Title,
		Body:              req.Body,
		RefType:           req.RefType,
		RefID:             refID,
		Status:            normalizeMemoryStatus(req.Status),
		ConfirmedByUserID: parseUUID(requestUserID(r)),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create agent memory")
		return
	}
	resp := agentMemoryToResponse(row)
	actorType, actorID := h.resolveActor(r, requestUserID(r), uuidToString(agent.WorkspaceID))
	h.publish(protocol.EventAgentMemoryCreated, uuidToString(agent.WorkspaceID), actorType, actorID, map[string]any{
		"agent_id": uuidToString(agent.ID),
		"memory":   resp,
	})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) ConfirmAgentMemory(w http.ResponseWriter, r *http.Request) {
	h.changeAgentMemoryCandidate(w, r, true)
}

func (h *Handler) RejectAgentMemory(w http.ResponseWriter, r *http.Request) {
	h.changeAgentMemoryCandidate(w, r, false)
}

func (h *Handler) changeAgentMemoryCandidate(w http.ResponseWriter, r *http.Request, confirm bool) {
	agentID := chi.URLParam(r, "id")
	memoryID := chi.URLParam(r, "memoryId")
	workspaceID := h.resolveWorkspaceID(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	agent, ok := h.loadAgentForUser(w, r, agentID)
	if !ok {
		return
	}
	if uuidToString(agent.WorkspaceID) != workspaceID {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	memoryUUID, ok := parseUUIDOrBadRequest(w, memoryID, "memory id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetAgentMemoryInWorkspace(r.Context(), db.GetAgentMemoryInWorkspaceParams{
		ID:          memoryUUID,
		WorkspaceID: agent.WorkspaceID,
		AgentID:     agent.ID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "memory not found")
		return
	}

	var (
		row db.AgentMemory
		err error
	)
	if confirm {
		row, err = h.Queries.ConfirmAgentMemory(r.Context(), db.ConfirmAgentMemoryParams{
			ID:                memoryUUID,
			WorkspaceID:       agent.WorkspaceID,
			AgentID:           agent.ID,
			ConfirmedByUserID: parseUUID(userID),
		})
	} else {
		row, err = h.Queries.RejectAgentMemory(r.Context(), db.RejectAgentMemoryParams{
			ID:          memoryUUID,
			WorkspaceID: agent.WorkspaceID,
			AgentID:     agent.ID,
		})
	}
	if err != nil {
		writeError(w, http.StatusConflict, "memory candidate is no longer pending")
		return
	}

	resp := agentMemoryToResponse(row)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	eventType := protocol.EventAgentMemoryRejected
	eventKind := "memory_rejected"
	eventTitle := "记忆候选已拒绝"
	if confirm {
		eventType = protocol.EventAgentMemoryConfirmed
		eventKind = "memory_confirmed"
		eventTitle = "记忆候选已确认"
	}
	payload, _ := json.Marshal(map[string]any{"memory_id": resp.ID})
	if _, err := h.Queries.CreateAgentEvent(r.Context(), db.CreateAgentEventParams{
		WorkspaceID: agent.WorkspaceID,
		AgentID:     agent.ID,
		Kind:        eventKind,
		Title:       eventTitle,
		Body:        resp.Title,
		Payload:     payload,
	}); err == nil {
		h.publish(protocol.EventAgentEventCreated, workspaceID, actorType, actorID, map[string]any{
			"agent_id": uuidToString(agent.ID),
		})
	}
	h.publish(eventType, workspaceID, actorType, actorID, map[string]any{
		"agent_id": uuidToString(agent.ID),
		"memory":   resp,
	})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ListAgentEvents(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	agent, ok := h.loadAgentForUser(w, r, agentID)
	if !ok {
		return
	}
	if uuidToString(agent.WorkspaceID) != workspaceID {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}

	rows, err := h.Queries.ListAgentEvents(r.Context(), db.ListAgentEventsParams{
		WorkspaceID: agent.WorkspaceID,
		AgentID:     agent.ID,
		Limit:       parseLimitQuery(r, 50, 200),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agent events")
		return
	}
	resp := make([]AgentEventResponse, len(rows))
	for i, row := range rows {
		resp[i] = agentEventToResponse(row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": resp})
}
