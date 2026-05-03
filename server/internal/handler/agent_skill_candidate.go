package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type AgentSkillCandidateResponse struct {
	ID                string  `json:"id"`
	WorkspaceID       string  `json:"workspace_id"`
	AgentID           string  `json:"agent_id"`
	Name              string  `json:"name"`
	Description       string  `json:"description"`
	Content           string  `json:"content"`
	Config            any     `json:"config"`
	RefType           string  `json:"ref_type"`
	RefID             *string `json:"ref_id"`
	Status            string  `json:"status"`
	SkillID           *string `json:"skill_id"`
	ConfirmedAt       *string `json:"confirmed_at"`
	ConfirmedByUserID *string `json:"confirmed_by_user_id"`
	CreatedAt         string  `json:"created_at"`
	UpdatedAt         string  `json:"updated_at"`
}

type CreateAgentSkillCandidateRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Content     string  `json:"content"`
	Config      any     `json:"config"`
	RefType     string  `json:"ref_type"`
	RefID       *string `json:"ref_id"`
	Status      string  `json:"status"`
}

func agentSkillCandidateToResponse(row db.AgentSkillCandidate) AgentSkillCandidateResponse {
	var config any
	if len(row.Config) > 0 {
		_ = json.Unmarshal(row.Config, &config)
	}
	if config == nil {
		config = map[string]any{}
	}
	return AgentSkillCandidateResponse{
		ID:                uuidToString(row.ID),
		WorkspaceID:       uuidToString(row.WorkspaceID),
		AgentID:           uuidToString(row.AgentID),
		Name:              row.Name,
		Description:       row.Description,
		Content:           row.Content,
		Config:            config,
		RefType:           row.RefType,
		RefID:             uuidToPtr(row.RefID),
		Status:            row.Status,
		SkillID:           uuidToPtr(row.SkillID),
		ConfirmedAt:       timestampToPtr(row.ConfirmedAt),
		ConfirmedByUserID: uuidToPtr(row.ConfirmedByUserID),
		CreatedAt:         timestampToString(row.CreatedAt),
		UpdatedAt:         timestampToString(row.UpdatedAt),
	}
}

func skillCandidateStatusesFromQuery(r *http.Request) []string {
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

func normalizeSkillCandidateStatus(raw string) string {
	switch raw {
	case "confirmed", "rejected":
		return raw
	default:
		return "candidate"
	}
}

func (h *Handler) ListAgentSkillCandidates(w http.ResponseWriter, r *http.Request) {
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

	rows, err := h.Queries.ListAgentSkillCandidates(r.Context(), db.ListAgentSkillCandidatesParams{
		WorkspaceID: agent.WorkspaceID,
		AgentID:     agent.ID,
		Limit:       parseLimitQuery(r, 20, 100),
		Statuses:    skillCandidateStatusesFromQuery(r),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list skill candidates")
		return
	}
	resp := make([]AgentSkillCandidateResponse, len(rows))
	for i, row := range rows {
		resp[i] = agentSkillCandidateToResponse(row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"candidates": resp})
}

func (h *Handler) CreateAgentSkillCandidate(w http.ResponseWriter, r *http.Request) {
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

	var req CreateAgentSkillCandidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	config, err := json.Marshal(req.Config)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid config")
		return
	}
	if req.Config == nil {
		config = []byte("{}")
	}
	var refID pgtype.UUID
	if req.RefID != nil && *req.RefID != "" {
		parsed, ok := parseUUIDOrBadRequest(w, *req.RefID, "ref_id")
		if !ok {
			return
		}
		refID = parsed
	}
	row, err := h.Queries.CreateAgentSkillCandidate(r.Context(), db.CreateAgentSkillCandidateParams{
		WorkspaceID: agent.WorkspaceID,
		AgentID:     agent.ID,
		Name:        req.Name,
		Description: req.Description,
		Content:     req.Content,
		Config:      config,
		RefType:     req.RefType,
		RefID:       refID,
		Status:      normalizeSkillCandidateStatus(req.Status),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create skill candidate")
		return
	}
	resp := agentSkillCandidateToResponse(row)
	actorType, actorID := h.resolveActor(r, requestUserID(r), workspaceID)
	h.publish(protocol.EventAgentSkillCandidateCreated, workspaceID, actorType, actorID, map[string]any{
		"agent_id":  uuidToString(agent.ID),
		"candidate": resp,
	})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) ConfirmAgentSkillCandidate(w http.ResponseWriter, r *http.Request) {
	h.changeAgentSkillCandidate(w, r, true)
}

func (h *Handler) RejectAgentSkillCandidate(w http.ResponseWriter, r *http.Request) {
	h.changeAgentSkillCandidate(w, r, false)
}

func (h *Handler) changeAgentSkillCandidate(w http.ResponseWriter, r *http.Request, confirm bool) {
	agentID := chi.URLParam(r, "id")
	candidateID := chi.URLParam(r, "candidateId")
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
	if confirm && !h.canManageAgent(w, r, agent) {
		return
	}
	candidateUUID, ok := parseUUIDOrBadRequest(w, candidateID, "skill candidate id")
	if !ok {
		return
	}
	candidate, err := h.Queries.GetAgentSkillCandidateInWorkspace(r.Context(), db.GetAgentSkillCandidateInWorkspaceParams{
		ID:          candidateUUID,
		WorkspaceID: agent.WorkspaceID,
		AgentID:     agent.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "skill candidate not found")
		return
	}

	var row db.AgentSkillCandidate
	if confirm {
		row, err = h.confirmAgentSkillCandidateTx(r, agent, candidate, userID)
	} else {
		row, err = h.Queries.RejectAgentSkillCandidate(r.Context(), db.RejectAgentSkillCandidateParams{
			ID:          candidateUUID,
			WorkspaceID: agent.WorkspaceID,
			AgentID:     agent.ID,
		})
	}
	if err != nil {
		writeError(w, http.StatusConflict, "skill candidate is no longer pending")
		return
	}

	resp := agentSkillCandidateToResponse(row)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	eventType := protocol.EventAgentSkillCandidateRejected
	eventKind := "skill_candidate_rejected"
	eventTitle := "技能候选已拒绝"
	if confirm {
		eventType = protocol.EventAgentSkillCandidateConfirmed
		eventKind = "skill_candidate_confirmed"
		eventTitle = "技能候选已确认"
	}
	payload, _ := json.Marshal(map[string]any{
		"candidate_id": resp.ID,
		"skill_id":     resp.SkillID,
	})
	if _, err := h.Queries.CreateAgentEvent(r.Context(), db.CreateAgentEventParams{
		WorkspaceID: agent.WorkspaceID,
		AgentID:     agent.ID,
		Kind:        eventKind,
		Title:       eventTitle,
		Body:        resp.Name,
		Payload:     payload,
	}); err == nil {
		h.publish(protocol.EventAgentEventCreated, workspaceID, actorType, actorID, map[string]any{
			"agent_id": uuidToString(agent.ID),
		})
	}
	h.publish(eventType, workspaceID, actorType, actorID, map[string]any{
		"agent_id":  uuidToString(agent.ID),
		"candidate": resp,
	})
	if confirm {
		h.publish(protocol.EventSkillCreated, workspaceID, actorType, actorID, map[string]any{
			"skill_id": resp.SkillID,
		})
		h.publish(protocol.EventAgentStatus, workspaceID, actorType, actorID, map[string]any{
			"agent_id": uuidToString(agent.ID),
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) confirmAgentSkillCandidateTx(r *http.Request, agent db.Agent, candidate db.AgentSkillCandidate, userID string) (db.AgentSkillCandidate, error) {
	if candidate.Status != "candidate" {
		return db.AgentSkillCandidate{}, errors.New("candidate is not pending")
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		return db.AgentSkillCandidate{}, err
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	var skill db.Skill
	skill, err = qtx.GetSkillByNameInWorkspace(r.Context(), db.GetSkillByNameInWorkspaceParams{
		WorkspaceID: agent.WorkspaceID,
		Name:        candidate.Name,
	})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return db.AgentSkillCandidate{}, err
		}
		skill, err = qtx.CreateSkill(r.Context(), db.CreateSkillParams{
			WorkspaceID: agent.WorkspaceID,
			Name:        candidate.Name,
			Description: candidate.Description,
			Content:     candidate.Content,
			Config:      candidate.Config,
			CreatedBy:   parseUUID(userID),
		})
		if err != nil {
			return db.AgentSkillCandidate{}, err
		}
	}
	if err := qtx.AddAgentSkill(r.Context(), db.AddAgentSkillParams{
		AgentID: agent.ID,
		SkillID: skill.ID,
	}); err != nil {
		return db.AgentSkillCandidate{}, err
	}
	row, err := qtx.ConfirmAgentSkillCandidate(r.Context(), db.ConfirmAgentSkillCandidateParams{
		ID:                candidate.ID,
		WorkspaceID:       agent.WorkspaceID,
		AgentID:           agent.ID,
		SkillID:           skill.ID,
		ConfirmedByUserID: parseUUID(userID),
	})
	if err != nil {
		return db.AgentSkillCandidate{}, err
	}
	if _, err := qtx.CreateAgentEvent(r.Context(), db.CreateAgentEventParams{
		WorkspaceID: agent.WorkspaceID,
		AgentID:     agent.ID,
		Kind:        "skill_attached",
		Title:       skill.Name,
		Body:        skill.Description,
		Payload:     []byte("{}"),
	}); err != nil {
		return db.AgentSkillCandidate{}, err
	}
	if err := tx.Commit(r.Context()); err != nil {
		return db.AgentSkillCandidate{}, err
	}
	return row, nil
}
