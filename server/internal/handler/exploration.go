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

type ExplorationResponse struct {
	ID               string  `json:"id"`
	WorkspaceID      string  `json:"workspace_id"`
	CreatedByUserID  string  `json:"created_by_user_id"`
	RelatedMissionID *string `json:"related_mission_id"`
	RelatedIdeaID    *string `json:"related_idea_id"`
	Topic            string  `json:"topic"`
	Question         string  `json:"question"`
	Status           string  `json:"status"`
	Decision         string  `json:"decision"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

type ExplorationBranchResponse struct {
	ID            string  `json:"id"`
	ExplorationID string  `json:"exploration_id"`
	AgentID       *string `json:"agent_id"`
	Title         string  `json:"title"`
	// PRD §14.7 — seven required fields, kept on the wire so the compare
	// panel can render every branch as a uniform table even when fields are
	// still empty (placeholder while the agent is still working).
	CoreProposal string `json:"core_proposal"`
	DesignLogic  string `json:"design_logic"`
	KeyDecisions string `json:"key_decisions"`
	CostEstimate string `json:"cost_estimate"`
	RiskPoints   string `json:"risk_points"`
	Fits         string `json:"fits"`
	DoesNotFit   string `json:"does_not_fit"`
	Verdict      string `json:"verdict"`
	SortOrder    int32  `json:"sort_order"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

type ExplorationDetailResponse struct {
	Exploration ExplorationResponse         `json:"exploration"`
	Branches    []ExplorationBranchResponse `json:"branches"`
}

type ListExplorationsResponse struct {
	Explorations []ExplorationResponse `json:"explorations"`
	Total        int                   `json:"total"`
}

// =====================
// Request types
// =====================

type CreateExplorationRequest struct {
	Topic            string  `json:"topic"`
	Question         string  `json:"question"`
	RelatedMissionID *string `json:"related_mission_id"`
	RelatedIdeaID    *string `json:"related_idea_id"`
}

type UpdateExplorationRequest struct {
	Topic    *string `json:"topic"`
	Question *string `json:"question"`
	Status   *string `json:"status"`
	Decision *string `json:"decision"`
}

type CreateExplorationBranchRequest struct {
	AgentID      *string `json:"agent_id"`
	Title        string  `json:"title"`
	CoreProposal string  `json:"core_proposal"`
	DesignLogic  string  `json:"design_logic"`
	KeyDecisions string  `json:"key_decisions"`
	CostEstimate string  `json:"cost_estimate"`
	RiskPoints   string  `json:"risk_points"`
	Fits         string  `json:"fits"`
	DoesNotFit   string  `json:"does_not_fit"`
	SortOrder    int32   `json:"sort_order"`
}

type UpdateExplorationBranchRequest struct {
	Title        *string `json:"title"`
	CoreProposal *string `json:"core_proposal"`
	DesignLogic  *string `json:"design_logic"`
	KeyDecisions *string `json:"key_decisions"`
	CostEstimate *string `json:"cost_estimate"`
	RiskPoints   *string `json:"risk_points"`
	Fits         *string `json:"fits"`
	DoesNotFit   *string `json:"does_not_fit"`
	Verdict      *string `json:"verdict"`
}

// =====================
// Converters & validators
// =====================

func explorationToResponse(e db.Exploration) ExplorationResponse {
	return ExplorationResponse{
		ID:               uuidToString(e.ID),
		WorkspaceID:      uuidToString(e.WorkspaceID),
		CreatedByUserID:  uuidToString(e.CreatedByUserID),
		RelatedMissionID: uuidToPtr(e.RelatedMissionID),
		RelatedIdeaID:    uuidToPtr(e.RelatedIdeaID),
		Topic:            e.Topic,
		Question:         e.Question,
		Status:           e.Status,
		Decision:         e.Decision,
		CreatedAt:        timestampToString(e.CreatedAt),
		UpdatedAt:        timestampToString(e.UpdatedAt),
	}
}

func explorationBranchToResponse(b db.ExplorationBranch) ExplorationBranchResponse {
	return ExplorationBranchResponse{
		ID:            uuidToString(b.ID),
		ExplorationID: uuidToString(b.ExplorationID),
		AgentID:       uuidToPtr(b.AgentID),
		Title:         b.Title,
		CoreProposal:  b.CoreProposal,
		DesignLogic:   b.DesignLogic,
		KeyDecisions:  b.KeyDecisions,
		CostEstimate:  b.CostEstimate,
		RiskPoints:    b.RiskPoints,
		Fits:          b.Fits,
		DoesNotFit:    b.DoesNotFit,
		Verdict:       b.Verdict,
		SortOrder:     b.SortOrder,
		CreatedAt:     timestampToString(b.CreatedAt),
		UpdatedAt:     timestampToString(b.UpdatedAt),
	}
}

func validateExplorationStatus(status string) bool {
	switch status {
	case "open", "converging", "closed", "archived":
		return true
	default:
		return false
	}
}

func validateBranchVerdict(verdict string) bool {
	switch verdict {
	case "pending", "winning", "runner_up", "discarded":
		return true
	default:
		return false
	}
}

// =====================
// Handlers — Exploration
// =====================

func (h *Handler) loadExplorationDetail(w http.ResponseWriter, r *http.Request, id string) (db.Exploration, []db.ExplorationBranch, bool) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return db.Exploration{}, nil, false
	}
	expUUID, ok := parseUUIDOrBadRequest(w, id, "exploration id")
	if !ok {
		return db.Exploration{}, nil, false
	}
	exp, err := h.Queries.GetExplorationInWorkspace(r.Context(), db.GetExplorationInWorkspaceParams{
		ID:          expUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "exploration not found")
		return db.Exploration{}, nil, false
	}
	branches, _ := h.Queries.ListExplorationBranches(r.Context(), exp.ID)
	return exp, branches, true
}

func (h *Handler) ListExplorations(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	var rows []db.Exploration
	var err error
	if r.URL.Query().Get("status") == "archived" {
		rows, err = h.Queries.ListArchivedExplorations(r.Context(), wsUUID)
	} else {
		rows, err = h.Queries.ListExplorations(r.Context(), wsUUID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list explorations")
		return
	}
	resp := make([]ExplorationResponse, len(rows))
	for i, e := range rows {
		resp[i] = explorationToResponse(e)
	}
	writeJSON(w, http.StatusOK, ListExplorationsResponse{Explorations: resp, Total: len(resp)})
}

func (h *Handler) GetExploration(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	exp, branches, ok := h.loadExplorationDetail(w, r, id)
	if !ok {
		return
	}
	resp := ExplorationDetailResponse{
		Exploration: explorationToResponse(exp),
		Branches:    make([]ExplorationBranchResponse, len(branches)),
	}
	for i, b := range branches {
		resp.Branches[i] = explorationBranchToResponse(b)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateExploration(w http.ResponseWriter, r *http.Request) {
	var req CreateExplorationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Topic = strings.TrimSpace(req.Topic)
	if req.Topic == "" {
		writeError(w, http.StatusBadRequest, "topic is required")
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

	// Verify related refs belong to this workspace before persisting — DB
	// has no cross-workspace FK constraint, so the handler is the only line
	// of defense against an exploration claiming to relate to a mission/idea
	// in a different workspace.
	var missionUUID, ideaUUID pgtype.UUID
	if req.RelatedMissionID != nil && strings.TrimSpace(*req.RelatedMissionID) != "" {
		uuid, ok := h.requireMissionInWorkspace(w, r, strings.TrimSpace(*req.RelatedMissionID), wsUUID)
		if !ok {
			return
		}
		missionUUID = uuid
	}
	if req.RelatedIdeaID != nil && strings.TrimSpace(*req.RelatedIdeaID) != "" {
		uuid, ok := h.requireIdeaInWorkspace(w, r, strings.TrimSpace(*req.RelatedIdeaID), wsUUID)
		if !ok {
			return
		}
		ideaUUID = uuid
	}

	exp, err := h.Queries.CreateExploration(r.Context(), db.CreateExplorationParams{
		WorkspaceID:      wsUUID,
		CreatedByUserID:  userUUID,
		RelatedMissionID: missionUUID,
		RelatedIdeaID:    ideaUUID,
		Topic:            req.Topic,
		Question:         strings.TrimSpace(req.Question),
		Status:           "open",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create exploration")
		return
	}
	resp := explorationToResponse(exp)
	h.publish(protocol.EventExplorationCreated, uuidToString(exp.WorkspaceID), "member", userID, map[string]any{"exploration": resp})
	writeJSON(w, http.StatusCreated, ExplorationDetailResponse{Exploration: resp, Branches: []ExplorationBranchResponse{}})
}

func (h *Handler) UpdateExploration(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	exp, _, ok := h.loadExplorationDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req UpdateExplorationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateExplorationParams{ID: exp.ID}
	if req.Topic != nil {
		trimmed := strings.TrimSpace(*req.Topic)
		params.Topic = pgtype.Text{String: trimmed, Valid: trimmed != ""}
	}
	if req.Question != nil {
		params.Question = pgtype.Text{String: *req.Question, Valid: true}
	}
	if req.Status != nil {
		if !validateExplorationStatus(*req.Status) {
			writeError(w, http.StatusBadRequest, "invalid status")
			return
		}
		params.Status = pgtype.Text{String: *req.Status, Valid: true}
	}
	if req.Decision != nil {
		params.Decision = pgtype.Text{String: *req.Decision, Valid: true}
	}

	updated, err := h.Queries.UpdateExploration(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update exploration")
		return
	}
	resp := explorationToResponse(updated)
	h.publish(protocol.EventExplorationUpdated, uuidToString(updated.WorkspaceID), "member", userID, map[string]any{"exploration": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ArchiveExploration(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	exp, _, ok := h.loadExplorationDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	archived, err := h.Queries.ArchiveExploration(r.Context(), exp.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive exploration")
		return
	}
	resp := explorationToResponse(archived)
	h.publish(protocol.EventExplorationArchived, uuidToString(archived.WorkspaceID), "member", userID, map[string]any{"exploration": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteExploration(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	exp, _, ok := h.loadExplorationDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if err := h.Queries.DeleteExploration(r.Context(), exp.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete exploration")
		return
	}
	h.publish(protocol.EventExplorationDeleted, uuidToString(exp.WorkspaceID), "member", userID, map[string]any{"exploration_id": uuidToString(exp.ID)})
	w.WriteHeader(http.StatusNoContent)
}

// =====================
// Handlers — ExplorationBranch
// =====================

func (h *Handler) CreateExplorationBranch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	exp, _, ok := h.loadExplorationDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req CreateExplorationBranchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	var agentUUID pgtype.UUID
	if req.AgentID != nil && strings.TrimSpace(*req.AgentID) != "" {
		uuid, agentOk := h.resolveAgentInWorkspace(w, r, strings.TrimSpace(*req.AgentID), "agent_id", wsUUID)
		if !agentOk {
			return
		}
		agentUUID = uuid
	}

	branch, err := h.Queries.CreateExplorationBranch(r.Context(), db.CreateExplorationBranchParams{
		ExplorationID: exp.ID,
		AgentID:       agentUUID,
		Title:         req.Title,
		CoreProposal:  req.CoreProposal,
		DesignLogic:   req.DesignLogic,
		KeyDecisions:  req.KeyDecisions,
		CostEstimate:  req.CostEstimate,
		RiskPoints:    req.RiskPoints,
		Fits:          req.Fits,
		DoesNotFit:    req.DoesNotFit,
		SortOrder:     req.SortOrder,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create exploration branch")
		return
	}
	resp := explorationBranchToResponse(branch)
	h.publish(protocol.EventExplorationBranchCreated, uuidToString(exp.WorkspaceID), "member", userID, map[string]any{
		"exploration_id": uuidToString(exp.ID),
		"branch":         resp,
	})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) UpdateExplorationBranch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	branchID := chi.URLParam(r, "branchId")
	exp, _, ok := h.loadExplorationDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	branchUUID, ok := parseUUIDOrBadRequest(w, branchID, "branch id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetExplorationBranchInExploration(r.Context(), db.GetExplorationBranchInExplorationParams{
		ID:            branchUUID,
		ExplorationID: exp.ID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "branch not found")
		return
	}

	var req UpdateExplorationBranchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Verdict != nil && !validateBranchVerdict(*req.Verdict) {
		writeError(w, http.StatusBadRequest, "invalid verdict")
		return
	}

	params := db.UpdateExplorationBranchParams{ID: branchUUID}
	if req.Title != nil {
		trimmed := strings.TrimSpace(*req.Title)
		params.Title = pgtype.Text{String: trimmed, Valid: trimmed != ""}
	}
	if req.CoreProposal != nil {
		params.CoreProposal = pgtype.Text{String: *req.CoreProposal, Valid: true}
	}
	if req.DesignLogic != nil {
		params.DesignLogic = pgtype.Text{String: *req.DesignLogic, Valid: true}
	}
	if req.KeyDecisions != nil {
		params.KeyDecisions = pgtype.Text{String: *req.KeyDecisions, Valid: true}
	}
	if req.CostEstimate != nil {
		params.CostEstimate = pgtype.Text{String: *req.CostEstimate, Valid: true}
	}
	if req.RiskPoints != nil {
		params.RiskPoints = pgtype.Text{String: *req.RiskPoints, Valid: true}
	}
	if req.Fits != nil {
		params.Fits = pgtype.Text{String: *req.Fits, Valid: true}
	}
	if req.DoesNotFit != nil {
		params.DoesNotFit = pgtype.Text{String: *req.DoesNotFit, Valid: true}
	}
	if req.Verdict != nil {
		params.Verdict = pgtype.Text{String: *req.Verdict, Valid: true}
	}

	updated, err := h.Queries.UpdateExplorationBranch(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update exploration branch")
		return
	}
	resp := explorationBranchToResponse(updated)
	h.publish(protocol.EventExplorationBranchUpdated, uuidToString(exp.WorkspaceID), "member", userID, map[string]any{
		"exploration_id": uuidToString(exp.ID),
		"branch":         resp,
	})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteExplorationBranch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	branchID := chi.URLParam(r, "branchId")
	exp, _, ok := h.loadExplorationDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	branchUUID, ok := parseUUIDOrBadRequest(w, branchID, "branch id")
	if !ok {
		return
	}
	if _, err := h.Queries.DeleteExplorationBranchInExploration(r.Context(), db.DeleteExplorationBranchInExplorationParams{
		ID:            branchUUID,
		ExplorationID: exp.ID,
	}); err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "branch not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete exploration branch")
		return
	}
	h.publish(protocol.EventExplorationBranchDeleted, uuidToString(exp.WorkspaceID), "member", userID, map[string]any{
		"exploration_id": uuidToString(exp.ID),
		"branch_id":      uuidToString(branchUUID),
	})
	w.WriteHeader(http.StatusNoContent)
}
