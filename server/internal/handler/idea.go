package handler

import (
	"encoding/json"
	"log/slog"
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

type IdeaResponse struct {
	ID                string   `json:"id"`
	WorkspaceID       string   `json:"workspace_id"`
	CreatedByUserID   string   `json:"created_by_user_id"`
	NurturerAgentID   *string  `json:"nurturer_agent_id"`
	PromotedMissionID *string  `json:"promoted_mission_id"`
	Title             string   `json:"title"`
	Description       string   `json:"description"`
	Source            string   `json:"source"`
	SourceRef         string   `json:"source_ref"`
	Status            string   `json:"status"`
	Tags              []string `json:"tags"`
	LastNurturedAt    *string  `json:"last_nurtured_at"`
	CreatedAt         string   `json:"created_at"`
	UpdatedAt         string   `json:"updated_at"`
}

type IdeaNurtureNoteResponse struct {
	ID                string          `json:"id"`
	IdeaID            string          `json:"idea_id"`
	AuthorAgentID     *string         `json:"author_agent_id"`
	Kind              string          `json:"kind"`
	Summary           string          `json:"summary"`
	Body              string          `json:"body"`
	ReferencesPayload json.RawMessage `json:"references_payload"`
	CreatedAt         string          `json:"created_at"`
}

type IdeaDetailResponse struct {
	Idea  IdeaResponse              `json:"idea"`
	Notes []IdeaNurtureNoteResponse `json:"notes"`
}

type ListIdeasResponse struct {
	Ideas []IdeaResponse `json:"ideas"`
	Total int            `json:"total"`
}

// =====================
// Request types
// =====================

type CreateIdeaRequest struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	Source          string   `json:"source"`
	SourceRef       string   `json:"source_ref"`
	Tags            []string `json:"tags"`
	NurturerAgentID *string  `json:"nurturer_agent_id"`
}

type UpdateIdeaRequest struct {
	Title           *string   `json:"title"`
	Description     *string   `json:"description"`
	Status          *string   `json:"status"`
	NurturerAgentID *string   `json:"nurturer_agent_id"`
	Tags            *[]string `json:"tags"`
}

type CreateIdeaNoteRequest struct {
	Kind              string          `json:"kind"`
	Summary           string          `json:"summary"`
	Body              string          `json:"body"`
	AuthorAgentID     *string         `json:"author_agent_id"`
	ReferencesPayload json.RawMessage `json:"references_payload"`
}

// =====================
// Converters
// =====================

func ideaToResponse(i db.Idea) IdeaResponse {
	tags := i.Tags
	if tags == nil {
		tags = []string{}
	}
	var lastNurtured *string
	if i.LastNurturedAt.Valid {
		s := timestampToString(i.LastNurturedAt)
		lastNurtured = &s
	}
	return IdeaResponse{
		ID:                uuidToString(i.ID),
		WorkspaceID:       uuidToString(i.WorkspaceID),
		CreatedByUserID:   uuidToString(i.CreatedByUserID),
		NurturerAgentID:   uuidToPtr(i.NurturerAgentID),
		PromotedMissionID: uuidToPtr(i.PromotedMissionID),
		Title:             i.Title,
		Description:       i.Description,
		Source:            i.Source,
		SourceRef:         i.SourceRef,
		Status:            i.Status,
		Tags:              tags,
		LastNurturedAt:    lastNurtured,
		CreatedAt:         timestampToString(i.CreatedAt),
		UpdatedAt:         timestampToString(i.UpdatedAt),
	}
}

func ideaNoteToResponse(n db.IdeaNurtureNote) IdeaNurtureNoteResponse {
	payload := json.RawMessage(n.ReferencesPayload)
	if len(payload) == 0 {
		payload = json.RawMessage("[]")
	}
	return IdeaNurtureNoteResponse{
		ID:                uuidToString(n.ID),
		IdeaID:            uuidToString(n.IdeaID),
		AuthorAgentID:     uuidToPtr(n.AuthorAgentID),
		Kind:              n.Kind,
		Summary:           n.Summary,
		Body:              n.Body,
		ReferencesPayload: payload,
		CreatedAt:         timestampToString(n.CreatedAt),
	}
}

func normalizeIdeaSource(raw string) string {
	switch raw {
	case "from_chat", "from_external":
		return raw
	default:
		return "manual"
	}
}

func validateIdeaStatus(status string) bool {
	switch status {
	case "draft", "nurturing", "promoted", "archived":
		return true
	default:
		return false
	}
}

func normalizeIdeaNoteKind(raw string) string {
	switch raw {
	case "related_history", "external_reference", "question":
		return raw
	default:
		return "new_angle"
	}
}

func ideaTitleFromDescription(description string) string {
	trimmed := strings.TrimSpace(description)
	if trimmed == "" {
		return "未命名想法"
	}
	split := strings.FieldsFunc(trimmed, func(r rune) bool {
		return r == '。' || r == '.' || r == '!' || r == '?' || r == '\n'
	})
	title := trimmed
	if len(split) > 0 && strings.TrimSpace(split[0]) != "" {
		title = strings.TrimSpace(split[0])
	}
	runes := []rune(title)
	if len(runes) > 50 {
		return string(runes[:50]) + "..."
	}
	return title
}

// =====================
// Handlers
// =====================

func (h *Handler) ListIdeas(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	var ideas []db.Idea
	var err error
	if r.URL.Query().Get("status") == "archived" {
		ideas, err = h.Queries.ListArchivedIdeas(r.Context(), wsUUID)
	} else {
		ideas, err = h.Queries.ListIdeas(r.Context(), wsUUID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list ideas")
		return
	}

	resp := make([]IdeaResponse, len(ideas))
	for i, idea := range ideas {
		resp[i] = ideaToResponse(idea)
	}
	writeJSON(w, http.StatusOK, ListIdeasResponse{Ideas: resp, Total: len(resp)})
}

func (h *Handler) loadIdeaDetail(w http.ResponseWriter, r *http.Request, id string) (db.Idea, []db.IdeaNurtureNote, bool) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return db.Idea{}, nil, false
	}
	ideaUUID, ok := parseUUIDOrBadRequest(w, id, "idea id")
	if !ok {
		return db.Idea{}, nil, false
	}
	idea, err := h.Queries.GetIdeaInWorkspace(r.Context(), db.GetIdeaInWorkspaceParams{
		ID:          ideaUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "idea not found")
		return db.Idea{}, nil, false
	}
	notes, _ := h.Queries.ListIdeaNurtureNotes(r.Context(), idea.ID)
	return idea, notes, true
}

func (h *Handler) GetIdea(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	idea, notes, ok := h.loadIdeaDetail(w, r, id)
	if !ok {
		return
	}
	resp := IdeaDetailResponse{Idea: ideaToResponse(idea), Notes: make([]IdeaNurtureNoteResponse, len(notes))}
	for i, n := range notes {
		resp.Notes[i] = ideaNoteToResponse(n)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateIdea(w http.ResponseWriter, r *http.Request) {
	var req CreateIdeaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	if req.Title == "" && req.Description == "" {
		writeError(w, http.StatusBadRequest, "title or description is required")
		return
	}
	if req.Title == "" {
		req.Title = ideaTitleFromDescription(req.Description)
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

	var nurturerUUID pgtype.UUID
	if req.NurturerAgentID != nil && strings.TrimSpace(*req.NurturerAgentID) != "" {
		uuid, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(*req.NurturerAgentID), "nurturer_agent_id")
		if !ok {
			return
		}
		agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID:          uuid,
			WorkspaceID: wsUUID,
		})
		if err != nil || agent.ArchivedAt.Valid {
			writeError(w, http.StatusBadRequest, "nurturer must be an active agent in this workspace")
			return
		}
		nurturerUUID = uuid
	}

	tags := req.Tags
	if tags == nil {
		tags = []string{}
	}

	idea, err := h.Queries.CreateIdea(r.Context(), db.CreateIdeaParams{
		WorkspaceID:     wsUUID,
		CreatedByUserID: userUUID,
		NurturerAgentID: nurturerUUID,
		Title:           req.Title,
		Description:     req.Description,
		Source:          normalizeIdeaSource(req.Source),
		SourceRef:       strings.TrimSpace(req.SourceRef),
		Tags:            tags,
		Status:          "nurturing",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create idea")
		return
	}

	resp := ideaToResponse(idea)
	h.publish(protocol.EventIdeaCreated, uuidToString(idea.WorkspaceID), "member", userID, map[string]any{"idea": resp})
	writeJSON(w, http.StatusCreated, IdeaDetailResponse{Idea: resp, Notes: []IdeaNurtureNoteResponse{}})
}

func (h *Handler) UpdateIdea(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	idea, _, ok := h.loadIdeaDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req UpdateIdeaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateIdeaParams{ID: idea.ID}
	clearNurturer := false
	if req.Title != nil {
		trimmed := strings.TrimSpace(*req.Title)
		params.Title = pgtype.Text{String: trimmed, Valid: trimmed != ""}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.Status != nil {
		if !validateIdeaStatus(*req.Status) {
			writeError(w, http.StatusBadRequest, "invalid status")
			return
		}
		// "promoted" must go through the dedicated promote endpoint so the
		// promoted_mission_id pointer is set atomically. Allowing it here
		// would leave the idea in promoted state with NULL mission ref.
		if *req.Status == "promoted" {
			writeError(w, http.StatusBadRequest, "use the promote endpoint to mark an idea as promoted")
			return
		}
		params.Status = pgtype.Text{String: *req.Status, Valid: true}
	}
	if req.NurturerAgentID != nil {
		trimmed := strings.TrimSpace(*req.NurturerAgentID)
		if trimmed == "" {
			clearNurturer = true
		} else {
			uuid, ok := parseUUIDOrBadRequest(w, trimmed, "nurturer_agent_id")
			if !ok {
				return
			}
			params.NurturerAgentID = uuid
		}
	}
	if req.Tags != nil {
		params.Tags = *req.Tags
	}

	updated, err := h.Queries.UpdateIdea(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update idea")
		return
	}
	if clearNurturer {
		updated, err = h.Queries.ClearIdeaNurturer(r.Context(), updated.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update idea")
			return
		}
	}
	resp := ideaToResponse(updated)
	h.publish(protocol.EventIdeaUpdated, uuidToString(updated.WorkspaceID), "member", userID, map[string]any{"idea": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ArchiveIdea(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	idea, _, ok := h.loadIdeaDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	archived, err := h.Queries.ArchiveIdea(r.Context(), idea.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive idea")
		return
	}
	resp := ideaToResponse(archived)
	h.publish(protocol.EventIdeaArchived, uuidToString(archived.WorkspaceID), "member", userID, map[string]any{"idea": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteIdea(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	idea, _, ok := h.loadIdeaDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if err := h.Queries.DeleteIdea(r.Context(), idea.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete idea")
		return
	}
	h.publish(protocol.EventIdeaDeleted, uuidToString(idea.WorkspaceID), "member", userID, map[string]any{"idea_id": uuidToString(idea.ID)})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ListIdeaNotes(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	_, notes, ok := h.loadIdeaDetail(w, r, id)
	if !ok {
		return
	}
	resp := make([]IdeaNurtureNoteResponse, len(notes))
	for i, n := range notes {
		resp[i] = ideaNoteToResponse(n)
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": resp, "total": len(resp)})
}

func (h *Handler) CreateIdeaNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	idea, _, ok := h.loadIdeaDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req CreateIdeaNoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Summary = strings.TrimSpace(req.Summary)
	if req.Summary == "" {
		writeError(w, http.StatusBadRequest, "summary is required")
		return
	}

	var authorUUID pgtype.UUID
	if req.AuthorAgentID != nil && strings.TrimSpace(*req.AuthorAgentID) != "" {
		uuid, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(*req.AuthorAgentID), "author_agent_id")
		if !ok {
			return
		}
		authorUUID = uuid
	}

	payload := req.ReferencesPayload
	if len(payload) == 0 {
		payload = json.RawMessage("[]")
	}

	note, err := h.Queries.CreateIdeaNurtureNote(r.Context(), db.CreateIdeaNurtureNoteParams{
		IdeaID:            idea.ID,
		AuthorAgentID:     authorUUID,
		Kind:              normalizeIdeaNoteKind(req.Kind),
		Summary:           req.Summary,
		Body:              req.Body,
		ReferencesPayload: payload,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create note")
		return
	}

	if _, err := h.Queries.TouchIdeaNurturedAt(r.Context(), idea.ID); err != nil {
		// non-fatal: the note is already persisted. Just log so we can spot
		// systemic issues with last_nurtured_at lagging behind notes.
		slog.Warn("failed to touch idea last_nurtured_at",
			"idea_id", uuidToString(idea.ID),
			"err", err,
		)
	}

	resp := ideaNoteToResponse(note)
	h.publish(protocol.EventIdeaNoteAdded, uuidToString(idea.WorkspaceID), "member", userID, map[string]any{
		"idea_id": uuidToString(idea.ID),
		"note":    resp,
	})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) DeleteIdeaNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	noteId := chi.URLParam(r, "noteId")
	idea, _, ok := h.loadIdeaDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	noteUUID, ok := parseUUIDOrBadRequest(w, noteId, "note id")
	if !ok {
		return
	}
	if _, err := h.Queries.DeleteIdeaNurtureNoteInIdea(r.Context(), db.DeleteIdeaNurtureNoteInIdeaParams{
		ID:     noteUUID,
		IdeaID: idea.ID,
	}); err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "note not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete note")
		return
	}
	h.publish(protocol.EventIdeaNoteDeleted, uuidToString(idea.WorkspaceID), "member", userID, map[string]any{
		"idea_id": uuidToString(idea.ID),
		"note_id": uuidToString(noteUUID),
	})
	w.WriteHeader(http.StatusNoContent)
}
