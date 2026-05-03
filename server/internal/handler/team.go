package handler

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// ── Response types ──────────────────────────────────────────────────────────

type TeamMemberResponse struct {
	AgentID  string `json:"agent_id"`
	Role     string `json:"role"`
	JoinedAt string `json:"joined_at"`
}

type TeamResponse struct {
	ID              string               `json:"id"`
	WorkspaceID     string               `json:"workspace_id"`
	Name            string               `json:"name"`
	Description     string               `json:"description"`
	CaptainAgentID  string               `json:"captain_agent_id"`
	CreatedByUserID string               `json:"created_by_user_id"`
	ArchivedAt      *string              `json:"archived_at"`
	CreatedAt       string               `json:"created_at"`
	UpdatedAt       string               `json:"updated_at"`
	Members         []TeamMemberResponse `json:"members"`
}

type TeamMessageResponse struct {
	ID            string  `json:"id"`
	ChatSessionID string  `json:"chat_session_id"`
	TeamID        string  `json:"team_id"`
	Role          string  `json:"role"`
	Content       string  `json:"content"`
	SenderAgentID *string `json:"sender_agent_id"`
	CreatedAt     string  `json:"created_at"`
}

type ListTeamMessagesResponse struct {
	Messages   []TeamMessageResponse `json:"messages"`
	NextCursor *string               `json:"next_cursor"`
}

type teamMessageCursor struct {
	CreatedAt string `json:"created_at"`
	ID        string `json:"id"`
}

// ── Converters ──────────────────────────────────────────────────────────────

func teamToResponse(t db.Team, members []db.TeamMember) TeamResponse {
	memberResp := make([]TeamMemberResponse, len(members))
	for i, m := range members {
		memberResp[i] = TeamMemberResponse{
			AgentID:  uuidToString(m.AgentID),
			Role:     m.Role,
			JoinedAt: timestampToString(m.JoinedAt),
		}
	}
	return TeamResponse{
		ID:              uuidToString(t.ID),
		WorkspaceID:     uuidToString(t.WorkspaceID),
		Name:            t.Name,
		Description:     t.Description,
		CaptainAgentID:  uuidToString(t.CaptainAgentID),
		CreatedByUserID: uuidToString(t.CreatedByUserID),
		ArchivedAt:      timestampToPtr(t.ArchivedAt),
		CreatedAt:       timestampToString(t.CreatedAt),
		UpdatedAt:       timestampToString(t.UpdatedAt),
		Members:         memberResp,
	}
}

func teamMessageToResponse(m db.ChatMessage, teamID string) TeamMessageResponse {
	var senderAgent *string
	if m.SenderAgentID.Valid {
		s := uuidToString(m.SenderAgentID)
		senderAgent = &s
	}
	return TeamMessageResponse{
		ID:            uuidToString(m.ID),
		ChatSessionID: uuidToString(m.ChatSessionID),
		TeamID:        teamID,
		Role:          m.Role,
		Content:       m.Content,
		SenderAgentID: senderAgent,
		CreatedAt:     timestampToString(m.CreatedAt),
	}
}

func (h *Handler) publishTeamMessage(workspaceID, actorType, actorID string, msg db.ChatMessage, teamID pgtype.UUID) {
	resp := teamMessageToResponse(msg, uuidToString(teamID))
	h.publish(protocol.EventTeamMessageCreated, workspaceID, actorType, actorID, map[string]any{
		"team_id": uuidToString(teamID),
		"message": resp,
	})
}

func (h *Handler) appendTeamSystemMessage(r *http.Request, workspaceID, userID string, sessionID, teamID pgtype.UUID, content string) {
	msg, err := h.Queries.CreateTeamChatMessage(r.Context(), db.CreateTeamChatMessageParams{
		ChatSessionID: sessionID,
		Role:          "assistant",
		Content:       content,
	})
	if err != nil {
		slog.Warn("failed to append team system message", "team_id", uuidToString(teamID), "error", err)
		return
	}
	h.publishTeamMessage(workspaceID, "system", userID, msg, teamID)
}

func encodeTeamMessageCursor(msg db.ChatMessage) string {
	createdAt := timestampToString(msg.CreatedAt)
	if msg.CreatedAt.Valid {
		createdAt = msg.CreatedAt.Time.Format(time.RFC3339Nano)
	}
	raw, _ := json.Marshal(teamMessageCursor{
		CreatedAt: createdAt,
		ID:        uuidToString(msg.ID),
	})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeTeamMessageCursor(raw string) (pgtype.Timestamptz, pgtype.UUID, bool) {
	if raw == "" {
		return pgtype.Timestamptz{}, pgtype.UUID{}, true
	}
	// Backwards-compatible convenience for hand-written query strings in tests
	// and local debugging: a plain RFC3339 timestamp still works, but new
	// cursors include the message id to make same-timestamp pagination stable.
	if ts, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return pgtype.Timestamptz{Time: ts, Valid: true}, pgtype.UUID{}, true
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	var cur teamMessageCursor
	if err := json.Unmarshal(decoded, &cur); err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	ts, err := time.Parse(time.RFC3339Nano, cur.CreatedAt)
	if err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	id, err := util.ParseUUID(cur.ID)
	if err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	return pgtype.Timestamptz{Time: ts, Valid: true}, id, true
}

// ── Request types ───────────────────────────────────────────────────────────

type CreateTeamRequest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	CaptainAgentID string   `json:"captain_agent_id"`
	MemberAgentIDs []string `json:"member_agent_ids"`
}

type UpdateTeamRequest struct {
	Name           *string `json:"name"`
	Description    *string `json:"description"`
	CaptainAgentID *string `json:"captain_agent_id"`
}

type AddTeamMemberRequest struct {
	AgentID string `json:"agent_id"`
}

type PostTeamMessageRequest struct {
	Content string `json:"content"`
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// loadTeamInWorkspace mirrors loadAutopilotInWorkspace — UUID validation +
// workspace scoping in one call. Returns 400 / 404 on the wire if needed.
func (h *Handler) loadTeamInWorkspace(w http.ResponseWriter, r *http.Request, teamID, workspaceID string) (db.Team, bool) {
	teamUUID, ok := parseUUIDOrBadRequest(w, teamID, "team id")
	if !ok {
		return db.Team{}, false
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return db.Team{}, false
	}
	team, err := h.Queries.GetTeamInWorkspace(r.Context(), db.GetTeamInWorkspaceParams{
		ID:          teamUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "team not found")
		return db.Team{}, false
	}
	return team, true
}

func (h *Handler) listTeamMembersOrEmpty(r *http.Request, teamID pgtype.UUID) []db.TeamMember {
	members, err := h.Queries.ListTeamMembers(r.Context(), teamID)
	if err != nil {
		return nil
	}
	return members
}

// ── Team CRUD ───────────────────────────────────────────────────────────────

func (h *Handler) ListTeams(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	var teams []db.Team
	var err error
	if r.URL.Query().Get("status") == "archived" {
		teams, err = h.Queries.ListArchivedTeams(r.Context(), wsUUID)
	} else {
		teams, err = h.Queries.ListTeams(r.Context(), wsUUID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list teams")
		return
	}

	resp := make([]TeamResponse, len(teams))
	for i, t := range teams {
		resp[i] = teamToResponse(t, h.listTeamMembersOrEmpty(r, t.ID))
	}
	writeJSON(w, http.StatusOK, map[string]any{"teams": resp, "total": len(resp)})
}

func (h *Handler) GetTeam(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	team, ok := h.loadTeamInWorkspace(w, r, id, workspaceID)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, teamToResponse(team, h.listTeamMembersOrEmpty(r, team.ID)))
}

func (h *Handler) CreateTeam(w http.ResponseWriter, r *http.Request) {
	var req CreateTeamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.CaptainAgentID == "" {
		writeError(w, http.StatusBadRequest, "captain_agent_id is required")
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
	captainUUID, ok := parseUUIDOrBadRequest(w, req.CaptainAgentID, "captain_agent_id")
	if !ok {
		return
	}

	// Captain must be a real agent in this workspace.
	if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
		ID:          captainUUID,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusBadRequest, "captain must be a valid agent in this workspace")
		return
	}

	memberUUIDs := make([]pgtype.UUID, 0, len(req.MemberAgentIDs))
	for _, idStr := range req.MemberAgentIDs {
		if idStr == "" || idStr == req.CaptainAgentID {
			continue
		}
		mUUID, ok := parseUUIDOrBadRequest(w, idStr, "member_agent_ids")
		if !ok {
			return
		}
		if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID:          mUUID,
			WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "member agent not found in this workspace")
			return
		}
		memberUUIDs = append(memberUUIDs, mUUID)
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create team")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	team, err := qtx.CreateTeam(r.Context(), db.CreateTeamParams{
		WorkspaceID:     wsUUID,
		Name:            req.Name,
		Description:     req.Description,
		CaptainAgentID:  captainUUID,
		CreatedByUserID: parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create team")
		return
	}

	// Captain is always the first member row with role='captain'.
	if _, err := qtx.AddTeamMember(r.Context(), db.AddTeamMemberParams{
		TeamID:  team.ID,
		AgentID: captainUUID,
		Role:    "captain",
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to register captain")
		return
	}
	for _, mUUID := range memberUUIDs {
		if _, err := qtx.AddTeamMember(r.Context(), db.AddTeamMemberParams{
			TeamID:  team.ID,
			AgentID: mUUID,
			Role:    "member",
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to add member")
			return
		}
	}

	members, err := qtx.ListTeamMembers(r.Context(), team.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list team members")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create team")
		return
	}

	resp := teamToResponse(team, members)
	h.publish(protocol.EventTeamCreated, workspaceID, "member", userID, map[string]any{"team": resp})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) UpdateTeam(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	team, ok := h.loadTeamInWorkspace(w, r, id, workspaceID)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req UpdateTeamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateTeamParams{ID: team.ID}
	if req.Name != nil {
		params.Name = pgtype.Text{String: *req.Name, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.CaptainAgentID != nil {
		newCaptainUUID, ok := parseUUIDOrBadRequest(w, *req.CaptainAgentID, "captain_agent_id")
		if !ok {
			return
		}
		// New captain must be a workspace member of agent kind.
		if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID:          newCaptainUUID,
			WorkspaceID: team.WorkspaceID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "captain must be a valid agent in this workspace")
			return
		}
		params.CaptainAgentID = newCaptainUUID
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update team")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	if req.CaptainAgentID != nil {
		// Ensure the new captain has a team_member row, then swap roles in
		// the same transaction as team.captain_agent_id.
		if _, err := qtx.AddTeamMember(r.Context(), db.AddTeamMemberParams{
			TeamID:  team.ID,
			AgentID: params.CaptainAgentID,
			Role:    "captain",
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to promote captain")
			return
		}
		if err := qtx.SetCaptainMember(r.Context(), db.SetCaptainMemberParams{
			TeamID:  team.ID,
			AgentID: params.CaptainAgentID,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to demote previous captain")
			return
		}
	}

	updated, err := qtx.UpdateTeam(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update team")
		return
	}
	members, err := qtx.ListTeamMembers(r.Context(), updated.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list team members")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update team")
		return
	}

	resp := teamToResponse(updated, members)
	h.publish(protocol.EventTeamUpdated, workspaceID, "member", userID, map[string]any{"team": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ArchiveTeam(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	team, ok := h.loadTeamInWorkspace(w, r, id, workspaceID)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	archived, err := h.Queries.ArchiveTeam(r.Context(), team.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive team")
		return
	}

	resp := teamToResponse(archived, h.listTeamMembersOrEmpty(r, archived.ID))
	h.publish(protocol.EventTeamArchived, workspaceID, "member", userID, map[string]any{"team": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) RestoreTeam(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	team, ok := h.loadTeamInWorkspace(w, r, id, workspaceID)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	restored, err := h.Queries.RestoreTeam(r.Context(), team.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to restore team")
		return
	}

	resp := teamToResponse(restored, h.listTeamMembersOrEmpty(r, restored.ID))
	h.publish(protocol.EventTeamUpdated, workspaceID, "member", userID, map[string]any{"team": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteTeam(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	team, ok := h.loadTeamInWorkspace(w, r, id, workspaceID)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	if err := h.Queries.DeleteTeam(r.Context(), team.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete team")
		return
	}

	h.publish(protocol.EventTeamDeleted, workspaceID, "member", userID, map[string]any{"team_id": uuidToString(team.ID)})
	w.WriteHeader(http.StatusNoContent)
}

// ── Members ─────────────────────────────────────────────────────────────────

func (h *Handler) AddTeamMember(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	team, ok := h.loadTeamInWorkspace(w, r, id, workspaceID)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req AddTeamMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.AgentID == "" {
		writeError(w, http.StatusBadRequest, "agent_id is required")
		return
	}
	agentUUID, ok := parseUUIDOrBadRequest(w, req.AgentID, "agent_id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
		ID:          agentUUID,
		WorkspaceID: team.WorkspaceID,
	}); err != nil {
		writeError(w, http.StatusBadRequest, "agent must be in this workspace")
		return
	}
	if uuidToString(agentUUID) == uuidToString(team.CaptainAgentID) {
		resp := teamToResponse(team, h.listTeamMembersOrEmpty(r, team.ID))
		writeJSON(w, http.StatusOK, resp)
		return
	}

	if _, err := h.Queries.AddTeamMember(r.Context(), db.AddTeamMemberParams{
		TeamID:  team.ID,
		AgentID: agentUUID,
		Role:    "member",
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add member")
		return
	}

	resp := teamToResponse(team, h.listTeamMembersOrEmpty(r, team.ID))
	h.publish(protocol.EventTeamMemberAdded, workspaceID, "member", userID, map[string]any{
		"team_id":  uuidToString(team.ID),
		"agent_id": req.AgentID,
		"team":     resp,
	})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) RemoveTeamMember(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	memberID := chi.URLParam(r, "memberId")
	workspaceID := h.resolveWorkspaceID(r)
	team, ok := h.loadTeamInWorkspace(w, r, id, workspaceID)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	memberUUID, ok := parseUUIDOrBadRequest(w, memberID, "memberId")
	if !ok {
		return
	}
	if uuidToString(memberUUID) == uuidToString(team.CaptainAgentID) {
		writeError(w, http.StatusBadRequest, "cannot remove the captain — promote another agent first")
		return
	}

	if err := h.Queries.RemoveTeamMember(r.Context(), db.RemoveTeamMemberParams{
		TeamID:  team.ID,
		AgentID: memberUUID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove member")
		return
	}

	resp := teamToResponse(team, h.listTeamMembersOrEmpty(r, team.ID))
	h.publish(protocol.EventTeamMemberRemoved, workspaceID, "member", userID, map[string]any{
		"team_id":  uuidToString(team.ID),
		"agent_id": memberID,
		"team":     resp,
	})
	writeJSON(w, http.StatusOK, resp)
}

// ── Group chat ──────────────────────────────────────────────────────────────

func (h *Handler) ListTeamMessages(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	team, ok := h.loadTeamInWorkspace(w, r, id, workspaceID)
	if !ok {
		return
	}

	limit := int32(50)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			writeError(w, http.StatusBadRequest, "invalid limit")
			return
		}
		if n > 100 {
			n = 100
		}
		limit = int32(n)
	}
	var before pgtype.Timestamptz
	var beforeID pgtype.UUID
	if raw := r.URL.Query().Get("before"); raw != "" {
		var ok bool
		before, beforeID, ok = decodeTeamMessageCursor(raw)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid before")
			return
		}
	}

	rows, err := h.Queries.ListTeamChatMessagesPage(r.Context(), db.ListTeamChatMessagesPageParams{
		TeamID:          team.ID,
		BeforeCreatedAt: before,
		BeforeID:        beforeID,
		LimitCount:      limit + 1,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list team messages")
		return
	}
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	teamIDStr := uuidToString(team.ID)
	resp := make([]TeamMessageResponse, len(rows))
	for i, m := range rows {
		resp[i] = teamMessageToResponse(m, teamIDStr)
	}
	var nextCursor *string
	if hasMore && len(rows) > 0 {
		cursor := encodeTeamMessageCursor(rows[0])
		nextCursor = &cursor
	}
	writeJSON(w, http.StatusOK, ListTeamMessagesResponse{Messages: resp, NextCursor: nextCursor})
}

func (h *Handler) PostTeamMessage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	workspaceID := h.resolveWorkspaceID(r)
	team, ok := h.loadTeamInWorkspace(w, r, id, workspaceID)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req PostTeamMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	// Lazy-create the team's group chat session on first message. The query
	// is idempotent and concurrency-safe via the unique team_id index.
	session, err := h.Queries.GetOrCreateTeamChatSession(r.Context(), db.GetOrCreateTeamChatSessionParams{
		TeamID:      pgtype.UUID{Bytes: team.ID.Bytes, Valid: true},
		WorkspaceID: team.WorkspaceID,
		CreatorID:   parseUUID(userID),
		Title:       team.Name,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to open team chat session")
		return
	}

	msg, err := h.Queries.CreateTeamChatMessage(r.Context(), db.CreateTeamChatMessageParams{
		ChatSessionID: session.ID,
		Role:          "user",
		Content:       req.Content,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to post message")
		return
	}

	resp := teamMessageToResponse(msg, uuidToString(team.ID))
	h.publishTeamMessage(workspaceID, "member", userID, msg, team.ID)

	// Phase 3: dispatch the message to the captain's runtime via the same
	// chat-task pipeline used by 1:1 chat. The daemon doesn't know about
	// teams — it just gets a chat task with agent_id=captain. When it
	// reports completion, service.CompleteTask writes the assistant
	// message back into the team chat session and senderAgentForChatSession
	// stamps sender_agent_id=captain so the UI attributes it correctly.
	captain, capErr := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
		ID:          team.CaptainAgentID,
		WorkspaceID: team.WorkspaceID,
	})
	if capErr != nil {
		h.appendTeamSystemMessage(r, workspaceID, userID, session.ID, team.ID, "负责人智能体不存在，消息已保留，但暂时无法派发。请编辑团队并重新选择负责人。")
		writeJSON(w, http.StatusCreated, resp)
		return
	}
	if captain.ArchivedAt.Valid {
		h.appendTeamSystemMessage(r, workspaceID, userID, session.ID, team.ID, "负责人智能体已归档，消息已保留，但暂时无法派发。请先恢复该智能体或更换负责人。")
		writeJSON(w, http.StatusCreated, resp)
		return
	}
	if _, err := h.TaskService.EnqueueChatTaskForAgent(r.Context(), session, captain.ID); err != nil {
		// The user's message is already part of the team history. Treat
		// dispatch failure as a visible system event in the room instead of
		// making the client roll back a message that actually exists.
		h.appendTeamSystemMessage(r, workspaceID, userID, session.ID, team.ID, "负责人暂时无法接管这条消息："+err.Error())
		writeJSON(w, http.StatusCreated, resp)
		return
	}
	if err := h.Queries.TouchChatSession(r.Context(), session.ID); err != nil {
		slog.Warn("failed to touch team chat session", "team_id", uuidToString(team.ID), "session_id", uuidToString(session.ID), "error", err)
	}

	writeJSON(w, http.StatusCreated, resp)
}
