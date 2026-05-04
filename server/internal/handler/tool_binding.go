package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// =====================
// Response types
// =====================

type ToolBindingResponse struct {
	ID               string          `json:"id"`
	WorkspaceID      string          `json:"workspace_id"`
	CreatedByUserID  string          `json:"created_by_user_id"`
	ToolType         string          `json:"tool_type"`
	ResourceRef      json.RawMessage `json:"resource_ref"`
	Label            string          `json:"label"`
	WriteEnabled     bool            `json:"write_enabled"`
	MissionID        *string         `json:"mission_id"`
	AgentID          *string         `json:"agent_id"`
	IdeaID           *string         `json:"idea_id"`
	CouncilSessionID *string         `json:"council_session_id"`
	LastSyncedAt     *string         `json:"last_synced_at"`
	CreatedAt        string          `json:"created_at"`
	UpdatedAt        string          `json:"updated_at"`
}

type ListToolBindingsResponse struct {
	Bindings []ToolBindingResponse `json:"bindings"`
	Total    int                   `json:"total"`
}

// =====================
// Request types
// =====================

type CreateToolBindingRequest struct {
	ToolType         string          `json:"tool_type"`
	ResourceRef      json.RawMessage `json:"resource_ref"`
	Label            string          `json:"label"`
	WriteEnabled     bool            `json:"write_enabled"`
	MissionID        *string         `json:"mission_id"`
	AgentID          *string         `json:"agent_id"`
	IdeaID           *string         `json:"idea_id"`
	CouncilSessionID *string         `json:"council_session_id"`
}

type UpdateToolBindingRequest struct {
	Label        *string         `json:"label"`
	ResourceRef  json.RawMessage `json:"resource_ref"`
	WriteEnabled *bool           `json:"write_enabled"`
}

// =====================
// Converters & validators
// =====================

func toolBindingToResponse(b db.ToolBinding) ToolBindingResponse {
	ref := json.RawMessage(b.ResourceRef)
	if len(ref) == 0 {
		ref = json.RawMessage("{}")
	}
	var lastSynced *string
	if b.LastSyncedAt.Valid {
		v := timestampToString(b.LastSyncedAt)
		lastSynced = &v
	}
	return ToolBindingResponse{
		ID:               uuidToString(b.ID),
		WorkspaceID:      uuidToString(b.WorkspaceID),
		CreatedByUserID:  uuidToString(b.CreatedByUserID),
		ToolType:         b.ToolType,
		ResourceRef:      ref,
		Label:            b.Label,
		WriteEnabled:     b.WriteEnabled,
		MissionID:        uuidToPtr(b.MissionID),
		AgentID:          uuidToPtr(b.AgentID),
		IdeaID:           uuidToPtr(b.IdeaID),
		CouncilSessionID: uuidToPtr(b.CouncilSessionID),
		LastSyncedAt:     lastSynced,
		CreatedAt:        timestampToString(b.CreatedAt),
		UpdatedAt:        timestampToString(b.UpdatedAt),
	}
}

func validateToolType(t string) bool {
	switch t {
	case "lark_doc", "lark_whiteboard", "figma_file", "obsidian_note", "local_repo":
		return true
	default:
		return false
	}
}

// =====================
// Handlers
// =====================

func (h *Handler) ListToolBindings(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	q := r.URL.Query()
	missionFilter := strings.TrimSpace(q.Get("mission_id"))
	agentFilter := strings.TrimSpace(q.Get("agent_id"))
	ideaFilter := strings.TrimSpace(q.Get("idea_id"))
	councilFilter := strings.TrimSpace(q.Get("council_session_id"))

	// Subject filters are workspace-scoped: we verify the referenced object
	// belongs to the caller's workspace BEFORE running the list query, so a
	// caller who guesses a foreign mission/agent/idea/council UUID gets 404
	// instead of leaking that workspace's binding URLs.
	var rows []db.ToolBinding
	var err error
	switch {
	case missionFilter != "":
		uuid, ok := h.requireMissionInWorkspace(w, r, missionFilter, wsUUID)
		if !ok {
			return
		}
		rows, err = h.Queries.ListToolBindingsForMission(r.Context(), uuid)
	case agentFilter != "":
		uuid, ok := h.resolveAgentInWorkspace(w, r, agentFilter, "agent_id", wsUUID)
		if !ok {
			return
		}
		rows, err = h.Queries.ListToolBindingsForAgent(r.Context(), uuid)
	case ideaFilter != "":
		uuid, ok := h.requireIdeaInWorkspace(w, r, ideaFilter, wsUUID)
		if !ok {
			return
		}
		rows, err = h.Queries.ListToolBindingsForIdea(r.Context(), uuid)
	case councilFilter != "":
		uuid, ok := h.requireCouncilSessionInWorkspace(w, r, councilFilter, wsUUID)
		if !ok {
			return
		}
		rows, err = h.Queries.ListToolBindingsForCouncil(r.Context(), uuid)
	default:
		rows, err = h.Queries.ListToolBindingsForWorkspace(r.Context(), wsUUID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tool bindings")
		return
	}
	resp := make([]ToolBindingResponse, len(rows))
	for i, b := range rows {
		resp[i] = toolBindingToResponse(b)
	}
	writeJSON(w, http.StatusOK, ListToolBindingsResponse{Bindings: resp, Total: len(resp)})
}

// requireMissionInWorkspace / requireIdeaInWorkspace / requireCouncilSessionInWorkspace
// are thin wrappers around the existing workspace-scoped Get* queries. They
// write a 400/404 on failure and return ok=false; the caller must return
// without further work. resolveAgentInWorkspace already exists for agents.
func (h *Handler) requireMissionInWorkspace(w http.ResponseWriter, r *http.Request, raw string, wsUUID pgtype.UUID) (pgtype.UUID, bool) {
	uuid, ok := parseUUIDOrBadRequest(w, raw, "mission_id")
	if !ok {
		return pgtype.UUID{}, false
	}
	if _, err := h.Queries.GetMissionInWorkspace(r.Context(), db.GetMissionInWorkspaceParams{
		ID:          uuid,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "mission not found in this workspace")
		return pgtype.UUID{}, false
	}
	return uuid, true
}

func (h *Handler) requireIdeaInWorkspace(w http.ResponseWriter, r *http.Request, raw string, wsUUID pgtype.UUID) (pgtype.UUID, bool) {
	uuid, ok := parseUUIDOrBadRequest(w, raw, "idea_id")
	if !ok {
		return pgtype.UUID{}, false
	}
	if _, err := h.Queries.GetIdeaInWorkspace(r.Context(), db.GetIdeaInWorkspaceParams{
		ID:          uuid,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "idea not found in this workspace")
		return pgtype.UUID{}, false
	}
	return uuid, true
}

func (h *Handler) requireCouncilSessionInWorkspace(w http.ResponseWriter, r *http.Request, raw string, wsUUID pgtype.UUID) (pgtype.UUID, bool) {
	uuid, ok := parseUUIDOrBadRequest(w, raw, "council_session_id")
	if !ok {
		return pgtype.UUID{}, false
	}
	if _, err := h.Queries.GetCouncilSessionInWorkspace(r.Context(), db.GetCouncilSessionInWorkspaceParams{
		ID:          uuid,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "council session not found in this workspace")
		return pgtype.UUID{}, false
	}
	return uuid, true
}

func (h *Handler) GetToolBinding(w http.ResponseWriter, r *http.Request) {
	binding, ok := h.loadToolBinding(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, toolBindingToResponse(binding))
}

func (h *Handler) loadToolBinding(w http.ResponseWriter, r *http.Request, id string) (db.ToolBinding, bool) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return db.ToolBinding{}, false
	}
	bindingUUID, ok := parseUUIDOrBadRequest(w, id, "tool binding id")
	if !ok {
		return db.ToolBinding{}, false
	}
	binding, err := h.Queries.GetToolBindingInWorkspace(r.Context(), db.GetToolBindingInWorkspaceParams{
		ID:          bindingUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "tool binding not found")
		return db.ToolBinding{}, false
	}
	return binding, true
}

func (h *Handler) CreateToolBinding(w http.ResponseWriter, r *http.Request) {
	var req CreateToolBindingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !validateToolType(req.ToolType) {
		writeError(w, http.StatusBadRequest, "invalid tool_type")
		return
	}
	subjectsSet := 0
	if req.MissionID != nil && strings.TrimSpace(*req.MissionID) != "" {
		subjectsSet++
	}
	if req.AgentID != nil && strings.TrimSpace(*req.AgentID) != "" {
		subjectsSet++
	}
	if req.IdeaID != nil && strings.TrimSpace(*req.IdeaID) != "" {
		subjectsSet++
	}
	if req.CouncilSessionID != nil && strings.TrimSpace(*req.CouncilSessionID) != "" {
		subjectsSet++
	}
	if subjectsSet != 1 {
		writeError(w, http.StatusBadRequest, "binding must reference exactly one of mission_id / agent_id / idea_id / council_session_id")
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}

	params := db.CreateToolBindingParams{
		WorkspaceID:     wsUUID,
		CreatedByUserID: userUUID,
		ToolType:        req.ToolType,
		Label:           req.Label,
		WriteEnabled:    req.WriteEnabled,
	}
	if len(req.ResourceRef) == 0 {
		params.ResourceRef = []byte("{}")
	} else {
		params.ResourceRef = req.ResourceRef
	}

	// Verify each subject ref actually belongs to the caller's workspace
	// before persisting. Without this, a caller could attach a binding under
	// their workspace_id but pointing at another workspace's mission/idea
	// — the DB CHECK only enforces "exactly one subject set", not workspace
	// alignment, so we have to enforce it at the handler layer.
	if req.MissionID != nil && strings.TrimSpace(*req.MissionID) != "" {
		uuid, ok := h.requireMissionInWorkspace(w, r, strings.TrimSpace(*req.MissionID), wsUUID)
		if !ok {
			return
		}
		params.MissionID = uuid
	}
	if req.AgentID != nil && strings.TrimSpace(*req.AgentID) != "" {
		uuid, ok := h.resolveAgentInWorkspace(w, r, strings.TrimSpace(*req.AgentID), "agent_id", wsUUID)
		if !ok {
			return
		}
		params.AgentID = uuid
	}
	if req.IdeaID != nil && strings.TrimSpace(*req.IdeaID) != "" {
		uuid, ok := h.requireIdeaInWorkspace(w, r, strings.TrimSpace(*req.IdeaID), wsUUID)
		if !ok {
			return
		}
		params.IdeaID = uuid
	}
	if req.CouncilSessionID != nil && strings.TrimSpace(*req.CouncilSessionID) != "" {
		uuid, ok := h.requireCouncilSessionInWorkspace(w, r, strings.TrimSpace(*req.CouncilSessionID), wsUUID)
		if !ok {
			return
		}
		params.CouncilSessionID = uuid
	}

	binding, err := h.Queries.CreateToolBinding(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create tool binding")
		return
	}
	resp := toolBindingToResponse(binding)
	h.publish(protocol.EventToolBindingCreated, uuidToString(binding.WorkspaceID), "member", userID, map[string]any{"binding": resp})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) UpdateToolBinding(w http.ResponseWriter, r *http.Request) {
	binding, ok := h.loadToolBinding(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	var req UpdateToolBindingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateToolBindingParams{ID: binding.ID}
	if req.Label != nil {
		params.Label = pgtype.Text{String: *req.Label, Valid: true}
	}
	if len(req.ResourceRef) > 0 {
		params.ResourceRef = req.ResourceRef
	}
	if req.WriteEnabled != nil {
		params.WriteEnabled = pgtype.Bool{Bool: *req.WriteEnabled, Valid: true}
	}

	updated, err := h.Queries.UpdateToolBinding(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update tool binding")
		return
	}
	resp := toolBindingToResponse(updated)
	h.publish(protocol.EventToolBindingUpdated, uuidToString(updated.WorkspaceID), "member", userID, map[string]any{"binding": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteToolBinding(w http.ResponseWriter, r *http.Request) {
	binding, ok := h.loadToolBinding(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if err := h.Queries.DeleteToolBinding(r.Context(), binding.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete tool binding")
		return
	}
	h.publish(protocol.EventToolBindingDeleted, uuidToString(binding.WorkspaceID), "member", userID, map[string]any{"binding_id": uuidToString(binding.ID)})
	w.WriteHeader(http.StatusNoContent)
}
