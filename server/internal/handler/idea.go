package handler

import (
	"encoding/json"
	"fmt"
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
	ProjectID         *string  `json:"project_id"`
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
	ProjectID       *string  `json:"project_id"`
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

type PromoteIdeaRequest struct {
	Title          string                         `json:"title"`
	CaptainAgentID string                         `json:"captain_agent_id"`
	MemberAgentIDs []string                       `json:"member_agent_ids"`
	TeamID         string                         `json:"team_id"`
	RiskLevel      string                         `json:"risk_level"`
	ExecutionMode  string                         `json:"execution_mode"`
	PlanItems      []CreateMissionPlanItemRequest `json:"plan_items"`
}

type PromoteIdeaResponse struct {
	Idea    IdeaResponse          `json:"idea"`
	Mission MissionDetailResponse `json:"mission"`
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
		ProjectID:         uuidToPtr(i.ProjectID),
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
	projectID, ok := h.projectIDFromQuery(w, r, wsUUID)
	if !ok {
		return
	}

	var ideas []db.Idea
	var err error
	if r.URL.Query().Get("status") == "archived" {
		ideas, err = h.Queries.ListArchivedIdeas(r.Context(), db.ListArchivedIdeasParams{
			WorkspaceID: wsUUID,
			ProjectID:   projectID,
		})
	} else {
		ideas, err = h.Queries.ListIdeas(r.Context(), db.ListIdeasParams{
			WorkspaceID: wsUUID,
			ProjectID:   projectID,
		})
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
	projectID, ok := h.projectIDFromRequest(w, r, req.ProjectID, wsUUID)
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
		ProjectID:       projectID,
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
			// Mirror CreateIdea — the nurturer must be an active agent in the
			// same workspace as the idea. Without this check, a caller could
			// PATCH in an agent_id from another workspace and silently
			// cross-link the two.
			workspaceID := h.resolveWorkspaceID(r)
			wsUUID, wsOk := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
			if !wsOk {
				return
			}
			uuid, ok := parseUUIDOrBadRequest(w, trimmed, "nurturer_agent_id")
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

// =====================
// Promote Idea → Mission
// =====================

// promotedMissionPrompt 把 idea 的 description 与养护笔记拼成 Mission 的 prompt，
// 让后续 task 派发时第一手就能拿到完整的孵化上下文。
func promotedMissionPrompt(idea db.Idea, notes []db.IdeaNurtureNote) string {
	var b strings.Builder
	desc := strings.TrimSpace(idea.Description)
	if desc == "" {
		desc = strings.TrimSpace(idea.Title)
	}
	b.WriteString(desc)
	if len(notes) > 0 {
		b.WriteString("\n\n养护笔记：")
		for _, n := range notes {
			b.WriteString("\n- ")
			b.WriteString(n.Summary)
			if body := strings.TrimSpace(n.Body); body != "" {
				b.WriteString("：")
				b.WriteString(body)
			}
		}
	}
	return b.String()
}

// promotedMissionBrief 在 missionBrief 基础上加「来源 Idea」前置区块，
// 让团队房间第一条消息就告诉负责人这个 Mission 是从哪条 Idea 升级来的、
// 用户在养鱼期间留过哪些角度。
func promotedMissionBrief(idea db.Idea, notes []db.IdeaNurtureNote, title, prompt string, plan []db.MissionPlanItem) string {
	var b strings.Builder
	b.WriteString("【Origin Mission · 来源 Idea】")
	b.WriteString(title)
	b.WriteString("\n\n来源 Idea：")
	b.WriteString(idea.Title)
	if desc := strings.TrimSpace(idea.Description); desc != "" {
		b.WriteString("\n")
		b.WriteString(desc)
	}
	if len(notes) > 0 {
		b.WriteString("\n\n养护笔记：")
		for _, n := range notes {
			b.WriteString("\n- ")
			b.WriteString(n.Summary)
			if body := strings.TrimSpace(n.Body); body != "" {
				b.WriteString("\n  ")
				b.WriteString(strings.ReplaceAll(body, "\n", "\n  "))
			}
		}
	}
	b.WriteString("\n\n目标：\n")
	b.WriteString(strings.TrimSpace(prompt))
	if len(plan) > 0 {
		b.WriteString("\n\n初始计划树：")
		for i, item := range plan {
			b.WriteString("\n")
			fmt.Fprintf(&b, "%d. ", i+1)
			b.WriteString(item.Title)
			if item.Description != "" {
				b.WriteString(" - ")
				b.WriteString(item.Description)
			}
		}
	}
	b.WriteString("\n\n请你作为团队负责人，先确认是否需要调整计划，再拆解任务、明确成员分工。中高风险动作先向用户确认。")
	return b.String()
}

// PromoteIdea 把一条养鱼池里的 Idea 升级为 Mission：复用 CreateMission 的事务序列，
// 在事务尾部把 idea 标记 promoted、回写 promoted_mission_id，避免出现「状态已升但找不到 Mission」的孤儿。
// 第一条群聊消息显式带「来源 Idea」前置区块，方便负责人秒速对齐上下文。
func (h *Handler) PromoteIdea(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	idea, notes, ok := h.loadIdeaDetail(w, r, id)
	if !ok {
		return
	}
	if idea.Status == "promoted" || idea.Status == "archived" {
		writeError(w, http.StatusBadRequest, "idea has already been promoted or archived")
		return
	}

	var req PromoteIdeaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.CaptainAgentID = strings.TrimSpace(req.CaptainAgentID)
	if req.CaptainAgentID == "" {
		writeError(w, http.StatusBadRequest, "captain_agent_id is required")
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = strings.TrimSpace(idea.Title)
	}
	if title == "" {
		title = "未命名任务"
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
	captainUUID, ok := parseUUIDOrBadRequest(w, req.CaptainAgentID, "captain_agent_id")
	if !ok {
		return
	}
	captain, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
		ID:          captainUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil || captain.ArchivedAt.Valid {
		writeError(w, http.StatusBadRequest, "captain must be an active agent in this workspace")
		return
	}

	memberUUIDs := make([]pgtype.UUID, 0, len(req.MemberAgentIDs))
	seenMembers := map[string]bool{req.CaptainAgentID: true}
	dedupedMemberIDs := make([]string, 0, len(req.MemberAgentIDs))
	for _, raw := range req.MemberAgentIDs {
		raw = strings.TrimSpace(raw)
		if raw == "" || seenMembers[raw] {
			continue
		}
		memberUUID, ok := parseUUIDOrBadRequest(w, raw, "member_agent_ids")
		if !ok {
			return
		}
		agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID:          memberUUID,
			WorkspaceID: wsUUID,
		})
		if err != nil || agent.ArchivedAt.Valid {
			writeError(w, http.StatusBadRequest, "member agent must be active in this workspace")
			return
		}
		seenMembers[raw] = true
		memberUUIDs = append(memberUUIDs, memberUUID)
		dedupedMemberIDs = append(dedupedMemberIDs, raw)
	}

	var team db.Team
	if strings.TrimSpace(req.TeamID) != "" {
		teamID, ok := parseUUIDOrBadRequest(w, req.TeamID, "team_id")
		if !ok {
			return
		}
		team, err = h.Queries.GetTeamInWorkspace(r.Context(), db.GetTeamInWorkspaceParams{
			ID:          teamID,
			WorkspaceID: wsUUID,
		})
		if err != nil || team.ArchivedAt.Valid {
			writeError(w, http.StatusBadRequest, "team not found in this workspace")
			return
		}
		if member, err := h.Queries.IsTeamMember(r.Context(), db.IsTeamMemberParams{TeamID: team.ID, AgentID: captainUUID}); err != nil || !member {
			writeError(w, http.StatusBadRequest, "captain must belong to the selected team")
			return
		}
	}

	prompt := promotedMissionPrompt(idea, notes)
	if len(req.PlanItems) == 0 {
		req.PlanItems = defaultMissionPlanItems(prompt, req.CaptainAgentID, dedupedMemberIDs)
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to promote idea")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	if !team.ID.Valid {
		team, err = qtx.CreateTeam(r.Context(), db.CreateTeamParams{
			WorkspaceID:     wsUUID,
			Name:            "任务小队 · " + title,
			Description:     "由 Origin 想法池升级 Mission 时自动创建。",
			CaptainAgentID:  captainUUID,
			CreatedByUserID: parseUUID(userID),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create mission team")
			return
		}
	}

	if _, err := qtx.AddTeamMember(r.Context(), db.AddTeamMemberParams{
		TeamID:  team.ID,
		AgentID: captainUUID,
		Role:    "captain",
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to register mission captain")
		return
	}
	if err := qtx.SetCaptainMember(r.Context(), db.SetCaptainMemberParams{
		TeamID:  team.ID,
		AgentID: captainUUID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to set mission captain")
		return
	}
	if uuidToString(team.CaptainAgentID) != req.CaptainAgentID {
		team, err = qtx.UpdateTeam(r.Context(), db.UpdateTeamParams{
			ID:             team.ID,
			CaptainAgentID: captainUUID,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update mission team captain")
			return
		}
	}
	for _, memberID := range memberUUIDs {
		if _, err := qtx.AddTeamMember(r.Context(), db.AddTeamMemberParams{
			TeamID:  team.ID,
			AgentID: memberID,
			Role:    "member",
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to register mission member")
			return
		}
	}

	session, err := qtx.GetOrCreateTeamChatSession(r.Context(), db.GetOrCreateTeamChatSessionParams{
		TeamID:      team.ID,
		WorkspaceID: wsUUID,
		CreatorID:   parseUUID(userID),
		Title:       team.Name,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to open mission room")
		return
	}

	mission, err := qtx.CreateMission(r.Context(), db.CreateMissionParams{
		WorkspaceID:     wsUUID,
		TeamID:          team.ID,
		CaptainAgentID:  captainUUID,
		CreatedByUserID: parseUUID(userID),
		Title:           title,
		Prompt:          prompt,
		Summary:         "",
		Outcome:         "",
		Status:          "planning",
		RiskLevel:       normalizeRiskLevel(req.RiskLevel),
		ExecutionMode:   normalizeExecutionMode(req.ExecutionMode),
		ChatSessionID:   session.ID,
		ProjectID:       idea.ProjectID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create mission")
		return
	}

	planItems := make([]db.MissionPlanItem, 0, len(req.PlanItems))
	for i, itemReq := range req.PlanItems {
		var assigned pgtype.UUID
		if itemReq.AssignedAgentID != nil && strings.TrimSpace(*itemReq.AssignedAgentID) != "" {
			assignedUUID, ok := parseUUIDOrBadRequest(w, *itemReq.AssignedAgentID, "assigned_agent_id")
			if !ok {
				return
			}
			assigned = assignedUUID
		}
		planTitle := strings.TrimSpace(itemReq.Title)
		if planTitle == "" {
			planTitle = "未命名步骤"
		}
		planItem, err := qtx.CreateMissionPlanItem(r.Context(), db.CreateMissionPlanItemParams{
			MissionID:       mission.ID,
			Title:           planTitle,
			Description:     itemReq.Description,
			Phase:           normalizeMissionPhase(itemReq.Phase),
			Status:          "todo",
			Priority:        normalizeMissionPriority(itemReq.Priority),
			RiskLevel:       normalizeRiskLevel(itemReq.RiskLevel),
			SortOrder:       int32(i),
			AssignedAgentID: assigned,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create mission plan")
			return
		}
		planItems = append(planItems, planItem)
	}

	if _, err := qtx.CreateMissionEvent(r.Context(), db.CreateMissionEventParams{
		MissionID:   mission.ID,
		WorkspaceID: wsUUID,
		ActorType:   "member",
		ActorID:     parseUUID(userID),
		Kind:        "mission_created",
		Title:       "Mission 已从想法池升级",
		Body:        prompt,
		Payload: eventPayload(map[string]any{
			"team_id":          uuidToString(team.ID),
			"captain_agent_id": req.CaptainAgentID,
			"member_agent_ids": dedupedMemberIDs,
			"source_idea_id":   uuidToString(idea.ID),
		}),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create mission event")
		return
	}

	msg, err := qtx.CreateTeamChatMessage(r.Context(), db.CreateTeamChatMessageParams{
		ChatSessionID: session.ID,
		Role:          "user",
		Content:       promotedMissionBrief(idea, notes, title, prompt, planItems),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to seed mission room")
		return
	}

	promotedIdea, err := qtx.PromoteIdeaToMission(r.Context(), db.PromoteIdeaToMissionParams{
		ID:                idea.ID,
		PromotedMissionID: mission.ID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mark idea as promoted")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to promote idea")
		return
	}

	h.publishTeamMessage(workspaceID, "member", userID, msg, team.ID)

	task, dispatchErr := h.TaskService.EnqueueChatTaskForAgent(r.Context(), session, captain.ID)
	finalStatus := "executing"
	assignmentStatus := "dispatched"
	var taskID pgtype.UUID
	var captainPlanItemID pgtype.UUID
	for _, item := range planItems {
		if uuidToString(item.AssignedAgentID) == req.CaptainAgentID {
			captainPlanItemID = item.ID
			break
		}
	}
	if !captainPlanItemID.Valid && len(planItems) > 0 {
		captainPlanItemID = planItems[0].ID
	}
	if dispatchErr != nil {
		finalStatus = "blocked"
		assignmentStatus = "blocked"
		h.appendTeamSystemMessage(r, workspaceID, userID, session.ID, team.ID, "负责人暂时无法接管这个 Mission："+dispatchErr.Error())
	} else {
		taskID = task.ID
	}

	assignment, err := h.Queries.CreateMissionAssignment(r.Context(), db.CreateMissionAssignmentParams{
		MissionID:  mission.ID,
		AgentID:    captain.ID,
		Status:     assignmentStatus,
		RiskLevel:  mission.RiskLevel,
		Output:     "",
		PlanItemID: captainPlanItemID,
		TaskID:     taskID,
	})
	if err != nil {
		slog.Warn("failed to create mission assignment", "mission_id", uuidToString(mission.ID), "error", err)
	}
	if _, err := h.Queries.CreateMissionEvent(r.Context(), db.CreateMissionEventParams{
		MissionID:   mission.ID,
		WorkspaceID: wsUUID,
		ActorType:   "system",
		Kind:        "captain_dispatched",
		Title:       "负责人已接管",
		Body:        "想法升级后的 Mission 简报已发送到团队房间，等待负责人拆解和派工。",
		Payload: eventPayload(map[string]any{
			"assignment_id": uuidToString(assignment.ID),
			"task_id":       uuidToString(taskID),
			"dispatch_error": func() string {
				if dispatchErr == nil {
					return ""
				}
				return dispatchErr.Error()
			}(),
		}),
	}); err != nil {
		slog.Warn("failed to create mission dispatch event", "mission_id", uuidToString(mission.ID), "error", err)
	}

	updated, err := h.Queries.UpdateMission(r.Context(), db.UpdateMissionParams{
		ID:     mission.ID,
		Status: pgtype.Text{String: finalStatus, Valid: true},
	})
	if err != nil {
		updated = mission
	}

	members := h.listTeamMembersOrEmpty(r, team.ID)
	assignments, _ := h.Queries.ListMissionAssignments(r.Context(), mission.ID)
	events, _ := h.Queries.ListMissionEvents(r.Context(), mission.ID)
	missionResp := missionDetailToResponse(updated, team, members, planItems, assignments, events)
	ideaResp := ideaToResponse(promotedIdea)

	h.publish(protocol.EventMissionCreated, workspaceID, "member", userID, map[string]any{"mission": missionResp.Mission})
	h.publish(protocol.EventIdeaUpdated, workspaceID, "member", userID, map[string]any{"idea": ideaResp})

	writeJSON(w, http.StatusCreated, PromoteIdeaResponse{
		Idea:    ideaResp,
		Mission: missionResp,
	})
}
