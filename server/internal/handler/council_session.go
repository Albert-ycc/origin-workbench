package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// =====================
// Response types
// =====================

type CouncilSessionResponse struct {
	ID                  string  `json:"id"`
	WorkspaceID         string  `json:"workspace_id"`
	ConvenerUserID      *string `json:"convener_user_id"`
	ConvenerAgentID     *string `json:"convener_agent_id"`
	RelatedMissionID    *string `json:"related_mission_id"`
	RelatedIdeaID       *string `json:"related_idea_id"`
	SourceChatSessionID *string `json:"source_chat_session_id"`
	Topic               string  `json:"topic"`
	Summary             string  `json:"summary"`
	ActivityLevel       string  `json:"activity_level"`
	Status              string  `json:"status"`
	Conclusion          string  `json:"conclusion"`
	StartedAt           string  `json:"started_at"`
	EndedAt             *string `json:"ended_at"`
	CreatedAt           string  `json:"created_at"`
	UpdatedAt           string  `json:"updated_at"`
}

type CouncilSessionParticipantResponse struct {
	ID        string  `json:"id"`
	SessionID string  `json:"session_id"`
	AgentID   string  `json:"agent_id"`
	Role      string  `json:"role"`
	JoinedAt  string  `json:"joined_at"`
	LeftAt    *string `json:"left_at"`
}

type CouncilSessionDetailResponse struct {
	Session      CouncilSessionResponse              `json:"session"`
	Participants []CouncilSessionParticipantResponse `json:"participants"`
}

type ListCouncilSessionsResponse struct {
	Sessions []CouncilSessionResponse `json:"sessions"`
	Total    int                      `json:"total"`
}

// =====================
// Request types
// =====================

type CreateCouncilSessionRequest struct {
	Topic                string   `json:"topic"`
	Summary              string   `json:"summary"`
	ActivityLevel        string   `json:"activity_level"`
	ConvenerAgentID      *string  `json:"convener_agent_id"`
	RelatedMissionID     *string  `json:"related_mission_id"`
	RelatedIdeaID        *string  `json:"related_idea_id"`
	SourceChatSessionID  *string  `json:"source_chat_session_id"`
	// PRD §17.6 — when convened from a project workspace's main chat,
	// project_id binds the council so adjourn writes back to memory_doc.
	ProjectID            *string  `json:"project_id"`
	ParticipantAgentIDs  []string `json:"participant_agent_ids"`
}

type UpdateCouncilSessionRequest struct {
	Topic         *string `json:"topic"`
	Summary       *string `json:"summary"`
	ActivityLevel *string `json:"activity_level"`
	Conclusion    *string `json:"conclusion"`
}

type AdjournCouncilSessionRequest struct {
	Conclusion *string `json:"conclusion"`
}

type AddCouncilParticipantRequest struct {
	AgentID string `json:"agent_id"`
	Role    string `json:"role"`
}

// =====================
// Converters
// =====================

func councilSessionToResponse(s db.CouncilSession) CouncilSessionResponse {
	var endedAt *string
	if s.EndedAt.Valid {
		v := timestampToString(s.EndedAt)
		endedAt = &v
	}
	return CouncilSessionResponse{
		ID:                  uuidToString(s.ID),
		WorkspaceID:         uuidToString(s.WorkspaceID),
		ConvenerUserID:      uuidToPtr(s.ConvenerUserID),
		ConvenerAgentID:     uuidToPtr(s.ConvenerAgentID),
		RelatedMissionID:    uuidToPtr(s.RelatedMissionID),
		RelatedIdeaID:       uuidToPtr(s.RelatedIdeaID),
		SourceChatSessionID: uuidToPtr(s.SourceChatSessionID),
		Topic:               s.Topic,
		Summary:             s.Summary,
		ActivityLevel:       s.ActivityLevel,
		Status:              s.Status,
		Conclusion:          s.Conclusion,
		StartedAt:           timestampToString(s.StartedAt),
		EndedAt:             endedAt,
		CreatedAt:           timestampToString(s.CreatedAt),
		UpdatedAt:           timestampToString(s.UpdatedAt),
	}
}

func councilParticipantToResponse(p db.CouncilSessionParticipant) CouncilSessionParticipantResponse {
	var leftAt *string
	if p.LeftAt.Valid {
		v := timestampToString(p.LeftAt)
		leftAt = &v
	}
	return CouncilSessionParticipantResponse{
		ID:        uuidToString(p.ID),
		SessionID: uuidToString(p.SessionID),
		AgentID:   uuidToString(p.AgentID),
		Role:      p.Role,
		JoinedAt:  timestampToString(p.JoinedAt),
		LeftAt:    leftAt,
	}
}

func normalizeActivityLevel(raw string) string {
	switch raw {
	case "quiet", "lively":
		return raw
	default:
		return "concise"
	}
}

func normalizeParticipantRole(raw string) string {
	switch raw {
	case "convener":
		return raw
	default:
		return "member"
	}
}

// resolveAgentInWorkspace validates that the agent belongs to the workspace and
// is not archived. Returns parsed UUID and ok=true on success. On failure it
// already wrote the HTTP error and the caller must return.
func (h *Handler) resolveAgentInWorkspace(w http.ResponseWriter, r *http.Request, raw string, fieldName string, wsUUID pgtype.UUID) (pgtype.UUID, bool) {
	uuid, ok := parseUUIDOrBadRequest(w, raw, fieldName)
	if !ok {
		return pgtype.UUID{}, false
	}
	agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
		ID:          uuid,
		WorkspaceID: wsUUID,
	})
	if err != nil || agent.ArchivedAt.Valid {
		writeError(w, http.StatusBadRequest, fieldName+" must be an active agent in this workspace")
		return pgtype.UUID{}, false
	}
	return uuid, true
}

// =====================
// Handlers
// =====================

func (h *Handler) ListCouncilSessions(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	var sessions []db.CouncilSession
	var err error
	if r.URL.Query().Get("status") == "archived" {
		sessions, err = h.Queries.ListArchivedCouncilSessions(r.Context(), wsUUID)
	} else {
		sessions, err = h.Queries.ListCouncilSessions(r.Context(), wsUUID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list council sessions")
		return
	}

	resp := make([]CouncilSessionResponse, len(sessions))
	for i, s := range sessions {
		resp[i] = councilSessionToResponse(s)
	}
	writeJSON(w, http.StatusOK, ListCouncilSessionsResponse{Sessions: resp, Total: len(resp)})
}

func (h *Handler) loadCouncilSessionDetail(w http.ResponseWriter, r *http.Request, id string) (db.CouncilSession, []db.CouncilSessionParticipant, bool) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return db.CouncilSession{}, nil, false
	}
	sessionUUID, ok := parseUUIDOrBadRequest(w, id, "session id")
	if !ok {
		return db.CouncilSession{}, nil, false
	}
	session, err := h.Queries.GetCouncilSessionInWorkspace(r.Context(), db.GetCouncilSessionInWorkspaceParams{
		ID:          sessionUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "council session not found")
		return db.CouncilSession{}, nil, false
	}
	participants, _ := h.Queries.ListCouncilSessionParticipants(r.Context(), session.ID)
	return session, participants, true
}

func (h *Handler) GetCouncilSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	session, participants, ok := h.loadCouncilSessionDetail(w, r, id)
	if !ok {
		return
	}
	resp := CouncilSessionDetailResponse{
		Session:      councilSessionToResponse(session),
		Participants: make([]CouncilSessionParticipantResponse, len(participants)),
	}
	for i, p := range participants {
		resp.Participants[i] = councilParticipantToResponse(p)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateCouncilSession(w http.ResponseWriter, r *http.Request) {
	var req CreateCouncilSessionRequest
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

	params := db.CreateCouncilSessionParams{
		WorkspaceID:    wsUUID,
		ConvenerUserID: userUUID,
		Topic:          req.Topic,
		Summary:        strings.TrimSpace(req.Summary),
		ActivityLevel:  normalizeActivityLevel(req.ActivityLevel),
		Status:         "running",
	}

	if req.ConvenerAgentID != nil && strings.TrimSpace(*req.ConvenerAgentID) != "" {
		uuid, ok := h.resolveAgentInWorkspace(w, r, strings.TrimSpace(*req.ConvenerAgentID), "convener_agent_id", wsUUID)
		if !ok {
			return
		}
		params.ConvenerAgentID = uuid
	}
	if req.RelatedMissionID != nil && strings.TrimSpace(*req.RelatedMissionID) != "" {
		uuid, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(*req.RelatedMissionID), "related_mission_id")
		if !ok {
			return
		}
		// validate mission belongs to workspace
		if _, err := h.Queries.GetMissionInWorkspace(r.Context(), db.GetMissionInWorkspaceParams{
			ID: uuid, WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "related_mission_id must be a mission in this workspace")
			return
		}
		params.RelatedMissionID = uuid
	}
	if req.RelatedIdeaID != nil && strings.TrimSpace(*req.RelatedIdeaID) != "" {
		uuid, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(*req.RelatedIdeaID), "related_idea_id")
		if !ok {
			return
		}
		if _, err := h.Queries.GetIdeaInWorkspace(r.Context(), db.GetIdeaInWorkspaceParams{
			ID: uuid, WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "related_idea_id must be an idea in this workspace")
			return
		}
		params.RelatedIdeaID = uuid
	}
	if req.SourceChatSessionID != nil && strings.TrimSpace(*req.SourceChatSessionID) != "" {
		uuid, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(*req.SourceChatSessionID), "source_chat_session_id")
		if !ok {
			return
		}
		params.SourceChatSessionID = uuid
	}
	if req.ProjectID != nil && strings.TrimSpace(*req.ProjectID) != "" {
		uuid, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(*req.ProjectID), "project_id")
		if !ok {
			return
		}
		if _, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
			ID: uuid, WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "project_id must be a project in this workspace")
			return
		}
		params.ProjectID = uuid
	}

	// Validate all participant agents up front before any inserts
	participantUUIDs := make([]pgtype.UUID, 0, len(req.ParticipantAgentIDs))
	seen := map[string]bool{}
	for _, raw := range req.ParticipantAgentIDs {
		raw = strings.TrimSpace(raw)
		if raw == "" || seen[raw] {
			continue
		}
		uuid, ok := h.resolveAgentInWorkspace(w, r, raw, "participant_agent_ids", wsUUID)
		if !ok {
			return
		}
		seen[raw] = true
		participantUUIDs = append(participantUUIDs, uuid)
	}

	session, err := h.Queries.CreateCouncilSession(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create council session")
		return
	}

	// If a convener agent was set, ensure it appears in the participant list
	if params.ConvenerAgentID.Valid {
		convenerInList := false
		for _, p := range participantUUIDs {
			if p == params.ConvenerAgentID {
				convenerInList = true
				break
			}
		}
		if !convenerInList {
			if _, err := h.Queries.AddCouncilSessionParticipant(r.Context(), db.AddCouncilSessionParticipantParams{
				SessionID: session.ID,
				AgentID:   params.ConvenerAgentID,
				Role:      "convener",
			}); err != nil {
				// non-fatal: log and continue, the session already exists
				writeError(w, http.StatusInternalServerError, "failed to add convener as participant")
				return
			}
		}
	}
	for _, agentUUID := range participantUUIDs {
		role := "member"
		if agentUUID == params.ConvenerAgentID {
			role = "convener"
		}
		if _, err := h.Queries.AddCouncilSessionParticipant(r.Context(), db.AddCouncilSessionParticipantParams{
			SessionID: session.ID,
			AgentID:   agentUUID,
			Role:      role,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to add participant")
			return
		}
	}

	// Reload participants for response
	participants, _ := h.Queries.ListCouncilSessionParticipants(r.Context(), session.ID)
	resp := CouncilSessionDetailResponse{
		Session:      councilSessionToResponse(session),
		Participants: make([]CouncilSessionParticipantResponse, len(participants)),
	}
	for i, p := range participants {
		resp.Participants[i] = councilParticipantToResponse(p)
	}

	h.publish(protocol.EventCouncilCreated, uuidToString(session.WorkspaceID), "member", userID, map[string]any{"session": resp.Session})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) UpdateCouncilSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	session, _, ok := h.loadCouncilSessionDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if session.Status == "archived" {
		writeError(w, http.StatusBadRequest, "cannot update an archived session")
		return
	}

	var req UpdateCouncilSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateCouncilSessionParams{ID: session.ID}
	if req.Topic != nil {
		trimmed := strings.TrimSpace(*req.Topic)
		if trimmed == "" {
			writeError(w, http.StatusBadRequest, "topic cannot be empty")
			return
		}
		params.Topic = pgtype.Text{String: trimmed, Valid: true}
	}
	if req.Summary != nil {
		params.Summary = pgtype.Text{String: *req.Summary, Valid: true}
	}
	if req.ActivityLevel != nil {
		params.ActivityLevel = pgtype.Text{String: normalizeActivityLevel(*req.ActivityLevel), Valid: true}
	}
	if req.Conclusion != nil {
		params.Conclusion = pgtype.Text{String: *req.Conclusion, Valid: true}
	}

	updated, err := h.Queries.UpdateCouncilSession(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update council session")
		return
	}
	resp := councilSessionToResponse(updated)
	h.publish(protocol.EventCouncilUpdated, uuidToString(updated.WorkspaceID), "member", userID, map[string]any{"session": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) AdjournCouncilSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	session, participants, ok := h.loadCouncilSessionDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if session.Status != "running" {
		writeError(w, http.StatusBadRequest, "only running sessions can be adjourned")
		return
	}

	var req AdjournCouncilSessionRequest
	// body is optional for adjourn
	_ = json.NewDecoder(r.Body).Decode(&req)

	params := db.AdjournCouncilSessionParams{ID: session.ID}
	if req.Conclusion != nil {
		params.Conclusion = pgtype.Text{String: *req.Conclusion, Valid: true}
	}

	adjourned, err := h.Queries.AdjournCouncilSession(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to adjourn council session")
		return
	}
	resp := councilSessionToResponse(adjourned)
	h.publish(protocol.EventCouncilAdjourned, uuidToString(adjourned.WorkspaceID), "member", userID, map[string]any{"session": resp})

	// Origin §14.5 — relay the conclusion back to whichever Direct Chat
	// originally convened the council so the user sees it in the original
	// thread instead of needing to remember to revisit /councils. Failures
	// here are logged but do not roll back the adjourn — the council itself
	// is the source of truth and the relay is a UX nicety.
	if adjourned.SourceChatSessionID.Valid {
		h.relayCouncilAdjournmentToSource(r, adjourned, participants, userID)
	}

	// PRD §17.6 — when the council session is bound to a v1.2 project
	// workspace, also append the conclusion to project.memory_doc 「关键决策」.
	// Single-agent direct chat councils (project_id IS NULL) keep the v1.1
	// behaviour above, no memory write.
	if adjourned.ProjectID.Valid && strings.TrimSpace(adjourned.Conclusion) != "" {
		h.appendCouncilConclusionToProjectMemory(r.Context(), adjourned)
	}

	writeJSON(w, http.StatusOK, resp)
}

// appendCouncilConclusionToProjectMemory prepends a one-line entry under
// "## 关键决策" of project.memory_doc with topic + conclusion + council link.
// Best-effort; failures are logged but do not roll back the adjourn.
func (h *Handler) appendCouncilConclusionToProjectMemory(ctx context.Context, session db.CouncilSession) {
	p, err := h.Queries.GetProjectV12(ctx, session.ProjectID)
	if err != nil {
		slog.Warn("council memory append: project not found",
			"council_id", uuidToString(session.ID),
			"project_id", uuidToString(session.ProjectID),
			"err", err)
		return
	}
	topic := strings.TrimSpace(session.Topic)
	if topic == "" {
		topic = "（未命名议题）"
	}
	conclusion := strings.TrimSpace(session.Conclusion)
	stamp := time.Now().Format("2006-01-02")
	entry := fmt.Sprintf("- %s · %s → %s（[查看会议](origin://councils/%s)）", stamp, topic, conclusion, uuidToString(session.ID))
	newDoc := appendToMemorySection(p.MemoryDoc, "## 关键决策", entry)
	updatedProject, err := h.Queries.UpdateProjectV12(ctx, db.UpdateProjectV12Params{
		ID:                 p.ID,
		MemoryDoc:          pgtype.Text{String: newDoc, Valid: true},
		MemoryDocUpdatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		slog.Warn("council memory append: update failed",
			"council_id", uuidToString(session.ID),
			"project_id", uuidToString(session.ProjectID),
			"err", err)
		return
	}
	h.publishProjectMemoryDocUpdated(updatedProject)
}

// relayCouncilAdjournmentToSource appends an assistant-role message to the
// Direct Chat that opened this council. Best-effort: any error is logged and
// the request still returns success because the council was adjourned.
func (h *Handler) relayCouncilAdjournmentToSource(r *http.Request, session db.CouncilSession, participants []db.CouncilSessionParticipant, userID string) {
	if !session.SourceChatSessionID.Valid {
		return
	}
	ctx := r.Context()
	chat, err := h.Queries.GetChatSessionInWorkspace(ctx, db.GetChatSessionInWorkspaceParams{
		ID:          session.SourceChatSessionID,
		WorkspaceID: session.WorkspaceID,
	})
	if err != nil {
		slog.Warn("council relay: source chat not found",
			"council_id", uuidToString(session.ID),
			"source_chat_id", uuidToString(session.SourceChatSessionID),
			"err", err,
		)
		return
	}

	body := buildCouncilAdjournNotice(
		session,
		h.councilConvenerLabel(ctx, session),
		h.councilParticipantLabels(ctx, participants),
	)

	msg, err := h.Queries.CreateChatMessage(ctx, db.CreateChatMessageParams{
		ChatSessionID: chat.ID,
		Role:          "assistant",
		Content:       body,
	})
	if err != nil {
		slog.Warn("council relay: failed to write source chat message",
			"council_id", uuidToString(session.ID),
			"source_chat_id", uuidToString(chat.ID),
			"err", err,
		)
		return
	}

	h.publishChat(
		protocol.EventChatMessage,
		uuidToString(session.WorkspaceID),
		"system",
		userID,
		uuidToString(chat.ID),
		protocol.ChatMessagePayload{
			ChatSessionID: uuidToString(chat.ID),
			MessageID:     uuidToString(msg.ID),
			Role:          "assistant",
			Content:       body,
			CreatedAt:     timestampToString(msg.CreatedAt),
		},
	)
}

// buildCouncilAdjournNotice composes the body of the relay message. The
// format is intentionally compact and recognizable so the user can scan past
// it in a long Direct Chat — and so future agents can cite it as context.
func buildCouncilAdjournNotice(session db.CouncilSession, convenerLabel string, participantLabels []string) string {
	var b strings.Builder
	b.WriteString("【Council 结论】")
	b.WriteString(strings.TrimSpace(session.Topic))
	b.WriteString("\n召集人：")
	if convenerLabel == "" {
		b.WriteString("（未知）")
	} else {
		b.WriteString(convenerLabel)
	}
	if len(participantLabels) > 0 {
		b.WriteString("\n参会者：")
		b.WriteString(strings.Join(participantLabels, "、"))
	}
	b.WriteString("\n结论：")
	conclusion := strings.TrimSpace(session.Conclusion)
	if conclusion == "" {
		b.WriteString("（未填写结论，见会议室记录）")
	} else {
		b.WriteString(conclusion)
	}
	return b.String()
}

// councilConvenerLabel resolves the convener's display name, preferring the
// agent name when an agent convened the session, falling back to the user
// when a human convened it. Best-effort lookups: on DB errors return "" and
// let the notice say "（未知）" rather than blowing up the relay.
func (h *Handler) councilConvenerLabel(ctx context.Context, session db.CouncilSession) string {
	if session.ConvenerAgentID.Valid {
		if agent, err := h.Queries.GetAgent(ctx, session.ConvenerAgentID); err == nil {
			return agent.Name
		}
	}
	if session.ConvenerUserID.Valid {
		if user, err := h.Queries.GetUser(ctx, session.ConvenerUserID); err == nil {
			return user.Name
		}
	}
	return ""
}

// councilParticipantLabels resolves agent display names for each participant.
// Skips silently on lookup failure so a single missing agent does not blank
// the entire roster.
func (h *Handler) councilParticipantLabels(ctx context.Context, participants []db.CouncilSessionParticipant) []string {
	labels := make([]string, 0, len(participants))
	for _, p := range participants {
		if p.LeftAt.Valid {
			continue
		}
		if agent, err := h.Queries.GetAgent(ctx, p.AgentID); err == nil && agent.Name != "" {
			labels = append(labels, agent.Name)
		}
	}
	return labels
}

func (h *Handler) ArchiveCouncilSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	session, _, ok := h.loadCouncilSessionDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	archived, err := h.Queries.ArchiveCouncilSession(r.Context(), session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive council session")
		return
	}
	resp := councilSessionToResponse(archived)
	h.publish(protocol.EventCouncilArchived, uuidToString(archived.WorkspaceID), "member", userID, map[string]any{"session": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteCouncilSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	session, _, ok := h.loadCouncilSessionDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if err := h.Queries.DeleteCouncilSession(r.Context(), session.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete council session")
		return
	}
	h.publish(protocol.EventCouncilDeleted, uuidToString(session.WorkspaceID), "member", userID, map[string]any{"session_id": uuidToString(session.ID)})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) AddCouncilSessionParticipant(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	session, _, ok := h.loadCouncilSessionDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if session.Status != "running" {
		writeError(w, http.StatusBadRequest, "can only add participants to a running session")
		return
	}

	var req AddCouncilParticipantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.AgentID = strings.TrimSpace(req.AgentID)
	if req.AgentID == "" {
		writeError(w, http.StatusBadRequest, "agent_id is required")
		return
	}
	agentUUID, ok := h.resolveAgentInWorkspace(w, r, req.AgentID, "agent_id", session.WorkspaceID)
	if !ok {
		return
	}

	participant, err := h.Queries.AddCouncilSessionParticipant(r.Context(), db.AddCouncilSessionParticipantParams{
		SessionID: session.ID,
		AgentID:   agentUUID,
		Role:      normalizeParticipantRole(req.Role),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add participant")
		return
	}
	resp := councilParticipantToResponse(participant)
	h.publish(protocol.EventCouncilParticipantJoined, uuidToString(session.WorkspaceID), "member", userID, map[string]any{
		"session_id":  uuidToString(session.ID),
		"participant": resp,
	})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) RemoveCouncilSessionParticipant(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	agentID := chi.URLParam(r, "agentId")
	session, _, ok := h.loadCouncilSessionDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	agentUUID, ok := parseUUIDOrBadRequest(w, agentID, "agent id")
	if !ok {
		return
	}
	if err := h.Queries.RemoveCouncilSessionParticipant(r.Context(), db.RemoveCouncilSessionParticipantParams{
		SessionID: session.ID,
		AgentID:   agentUUID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove participant")
		return
	}
	h.publish(protocol.EventCouncilParticipantLeft, uuidToString(session.WorkspaceID), "member", userID, map[string]any{
		"session_id": uuidToString(session.ID),
		"agent_id":   uuidToString(agentUUID),
	})
	w.WriteHeader(http.StatusNoContent)
}
