package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// ProjectV12 endpoints (PRD §17 — v1.2 项目工作区).
// Mounted under /api/v12/projects so they don't collide with the legacy v1.0
// /api/projects routes (those still serve issue-classification, kept for
// backwards compat). Frontend code should call ApiClient.listProjectsV12 etc.

type ProjectV12Response struct {
	ID                  string  `json:"id"`
	WorkspaceID         string  `json:"workspace_id"`
	TeamID              *string `json:"team_id"`
	MainChatSessionID   *string `json:"main_chat_session_id"`
	Title               string  `json:"title"`
	Description         string  `json:"description"`
	LocalDir            string  `json:"local_dir"`
	MemoryDoc           string  `json:"memory_doc"`
	MemoryDocUpdatedAt  *string `json:"memory_doc_updated_at"`
	CompactionCount     int32   `json:"compaction_count"`
	Status              string  `json:"status"`
	CreatedAt           string  `json:"created_at"`
	UpdatedAt           string  `json:"updated_at"`
}

type ListProjectsV12Response struct {
	Projects []ProjectV12Response `json:"projects"`
	Total    int                  `json:"total"`
}

type CreateProjectV12Request struct {
	// AgentIDs 是项目要拉进来的 agent 列表（含 captain）。后端会按 agent
	// 集合 hash 找现有团队复用，找不到才创建新团队。这是 v1.2 第二轮简化：
	// 用户视角只剩"建项目"一个动作，团队作为 agent 子集自动派生。
	AgentIDs        []string `json:"agent_ids"`
	CaptainAgentID  string   `json:"captain_agent_id"`
	// TeamID 兼容旧客户端：如果直接传了 team_id 就直接绑，跳过 find-or-create。
	TeamID      string `json:"team_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	LocalDir    string `json:"local_dir"`
	MemoryDoc   string `json:"memory_doc"`
}

type UpdateProjectV12Request struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	MemoryDoc   *string `json:"memory_doc"`
}

func projectV12ToResponse(p db.Project) ProjectV12Response {
	desc := ""
	if p.Description.Valid {
		desc = p.Description.String
	}
	return ProjectV12Response{
		ID:                 uuidToString(p.ID),
		WorkspaceID:        uuidToString(p.WorkspaceID),
		TeamID:             uuidToPtr(p.TeamID),
		MainChatSessionID:  uuidToPtr(p.MainChatSessionID),
		Title:              p.Title,
		Description:        desc,
		LocalDir:           p.LocalDir,
		MemoryDoc:          p.MemoryDoc,
		MemoryDocUpdatedAt: timestampToPtr(p.MemoryDocUpdatedAt),
		CompactionCount:    p.CompactionCount,
		Status:             p.Status,
		CreatedAt:          timestampToString(p.CreatedAt),
		UpdatedAt:          timestampToString(p.UpdatedAt),
	}
}

func (h *Handler) ListProjectsV12(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	rows, err := h.Queries.ListProjectsV12(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list projects")
		return
	}
	resp := make([]ProjectV12Response, len(rows))
	for i, p := range rows {
		resp[i] = projectV12ToResponse(p)
	}
	writeJSON(w, http.StatusOK, ListProjectsV12Response{Projects: resp, Total: len(resp)})
}

func (h *Handler) GetProjectV12(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	p, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID:          pid,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	writeJSON(w, http.StatusOK, projectV12ToResponse(p))
}

func (h *Handler) CreateProjectV12(w http.ResponseWriter, r *http.Request) {
	var req CreateProjectV12Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	if strings.TrimSpace(req.LocalDir) == "" {
		writeError(w, http.StatusBadRequest, "local_dir is required")
		return
	}
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}

	// Resolve team: 三条路径
	//   1. 显式 team_id → 直接验证 + 用
	//   2. agent_ids[] + captain_agent_id → find-or-create
	//   3. 都没有 → 报错
	var teamUUID pgtype.UUID
	if strings.TrimSpace(req.TeamID) != "" {
		uuid, ok := parseUUIDOrBadRequest(w, req.TeamID, "team_id")
		if !ok {
			return
		}
		teamUUID = uuid
	} else if len(req.AgentIDs) > 0 {
		captainUUID, ok := parseUUIDOrBadRequest(w, req.CaptainAgentID, "captain_agent_id")
		if !ok {
			return
		}
		agentUUIDs := make([]pgtype.UUID, 0, len(req.AgentIDs))
		seenCaptain := false
		for _, raw := range req.AgentIDs {
			u, ok := parseUUIDOrBadRequest(w, raw, "agent_ids")
			if !ok {
				return
			}
			agentUUIDs = append(agentUUIDs, u)
			if uuidEqual(u, captainUUID) {
				seenCaptain = true
			}
		}
		if !seenCaptain {
			writeError(w, http.StatusBadRequest, "captain_agent_id must be included in agent_ids")
			return
		}
		team, err := h.findOrCreateTeamForAgents(r.Context(), wsUUID, userUUID, captainUUID, agentUUIDs, req.Title)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to resolve team: "+err.Error())
			return
		}
		teamUUID = team.ID
	} else {
		writeError(w, http.StatusBadRequest, "either team_id or agent_ids must be provided")
		return
	}

	p, err := h.Queries.CreateProjectV12(r.Context(), db.CreateProjectV12Params{
		WorkspaceID: wsUUID,
		TeamID:      teamUUID,
		Title:       req.Title,
		Description: pgtype.Text{String: req.Description, Valid: req.Description != ""},
		LocalDir:    req.LocalDir,
		MemoryDoc:   req.MemoryDoc,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create project: "+err.Error())
		return
	}
	// Bind the project's main chat session so the workspace page can render it
	// without a second user action. find-or-create on (team_id, project_id) is
	// idempotent — calling it again is a no-op.
	if _, err := h.ensureProjectMainChat(r.Context(), p, userUUID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to bind project main chat: "+err.Error())
		return
	}
	// Reload to pick up main_chat_session_id.
	p2, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID:          p.ID,
		WorkspaceID: wsUUID,
	})
	if err == nil {
		p = p2
	}
	resp := projectV12ToResponse(p)
	h.publish(protocol.EventProjectCreated, uuidToString(p.WorkspaceID), "system", "", map[string]any{"project": resp})
	writeJSON(w, http.StatusCreated, resp)
}

// ensureProjectMainChat returns the (team, project) chat_session, creating it
// on first call and writing the id back to project.main_chat_session_id.
// Used by CreateProjectV12 and the GetProjectMainChat endpoint (so the link
// self-heals if a project predates this code).
func (h *Handler) ensureProjectMainChat(ctx context.Context, p db.Project, userUUID pgtype.UUID) (db.ChatSession, error) {
	if !p.TeamID.Valid {
		return db.ChatSession{}, fmt.Errorf("project has no team bound")
	}
	session, err := h.Queries.GetOrCreateTeamChatSession(ctx, db.GetOrCreateTeamChatSessionParams{
		TeamID:      p.TeamID,
		WorkspaceID: p.WorkspaceID,
		CreatorID:   userUUID,
		Title:       p.Title,
		ProjectID:   pgtype.UUID{Bytes: p.ID.Bytes, Valid: true},
	})
	if err != nil {
		return db.ChatSession{}, fmt.Errorf("get-or-create main chat: %w", err)
	}
	// Bind anchor on first ensure; subsequent calls keep the same id.
	if !p.MainChatSessionID.Valid {
		if err := h.Queries.SetProjectMainChatSessionV12(ctx, db.SetProjectMainChatSessionV12Params{
			ID:                 p.ID,
			MainChatSessionID:  pgtype.UUID{Bytes: session.ID.Bytes, Valid: true},
		}); err != nil {
			return session, fmt.Errorf("bind main chat anchor: %w", err)
		}
	}
	return session, nil
}

// findOrCreateTeamForAgents 给定 (workspace, captain, member set)，找 agent
// 集合完全匹配且 captain 一致的现有 team；找不到就建一个新 team + 加成员。
//
// 这是 v1.2 第二轮简化的核心：用户视角只看到"建项目"，团队是项目的派生
// 属性。同样的 agent 子集做多个项目时自动复用同一 team_id（agent 长期上
// 下文跨项目不丢）。
func (h *Handler) findOrCreateTeamForAgents(
	ctx context.Context,
	workspaceID pgtype.UUID,
	creatorUserID pgtype.UUID,
	captainAgentID pgtype.UUID,
	memberAgentIDs []pgtype.UUID,
	defaultProjectTitle string,
) (db.Team, error) {
	// 把 memberAgentIDs 排序后转成 set 用于比较
	want := make(map[[16]byte]bool, len(memberAgentIDs))
	for _, m := range memberAgentIDs {
		if m.Valid {
			want[m.Bytes] = true
		}
	}

	teams, err := h.Queries.ListTeams(ctx, workspaceID)
	if err != nil {
		return db.Team{}, fmt.Errorf("list teams: %w", err)
	}
	for _, t := range teams {
		if !uuidEqual(t.CaptainAgentID, captainAgentID) {
			continue
		}
		members, err := h.Queries.ListTeamMembers(ctx, t.ID)
		if err != nil {
			continue
		}
		if len(members) != len(want) {
			continue
		}
		match := true
		for _, m := range members {
			if !want[m.AgentID.Bytes] {
				match = false
				break
			}
		}
		if match {
			return t, nil
		}
	}

	// 没找到匹配 → 建一个新 team
	teamName := teamNameFromAgents(ctx, h.Queries, captainAgentID, memberAgentIDs, defaultProjectTitle)
	team, err := h.Queries.CreateTeam(ctx, db.CreateTeamParams{
		WorkspaceID:     workspaceID,
		Name:            teamName,
		Description:     "由项目「" + defaultProjectTitle + "」自动建立的 agent 协作组",
		CaptainAgentID:  captainAgentID,
		CreatedByUserID: creatorUserID,
	})
	if err != nil {
		return db.Team{}, fmt.Errorf("create team: %w", err)
	}
	for _, m := range memberAgentIDs {
		role := "member"
		if uuidEqual(m, captainAgentID) {
			role = "captain"
		}
		if _, err := h.Queries.AddTeamMember(ctx, db.AddTeamMemberParams{
			TeamID:  team.ID,
			AgentID: m,
			Role:    role,
		}); err != nil {
			// 部分失败不阻塞 team 创建——下次同 agent 集合 find-or-create 还会复用此 team
			continue
		}
	}
	return team, nil
}

// teamNameFromAgents 给自动建的 team 起个用户能认得出的名字。优先从
// captain 名字 + 成员数派生，失败时 fallback 到项目标题。
func teamNameFromAgents(
	ctx context.Context,
	q *db.Queries,
	captainAgentID pgtype.UUID,
	memberAgentIDs []pgtype.UUID,
	projectTitle string,
) string {
	if captain, err := q.GetAgent(ctx, captainAgentID); err == nil && captain.Name != "" {
		return captain.Name + "组（" + strings.TrimSpace(projectTitle) + "）"
	}
	return strings.TrimSpace(projectTitle) + "团队"
}

func (h *Handler) UpdateProjectV12(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID:          pid,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	var req UpdateProjectV12Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	params := db.UpdateProjectV12Params{ID: pid}
	if req.Title != nil {
		params.Title = pgtype.Text{String: *req.Title, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.Status != nil {
		switch *req.Status {
		case "active", "paused", "completed", "archived":
			params.Status = pgtype.Text{String: *req.Status, Valid: true}
		default:
			writeError(w, http.StatusBadRequest, "invalid status")
			return
		}
	}
	if req.MemoryDoc != nil {
		params.MemoryDoc = pgtype.Text{String: *req.MemoryDoc, Valid: true}
		params.MemoryDocUpdatedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}
	p, err := h.Queries.UpdateProjectV12(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update project")
		return
	}
	resp := projectV12ToResponse(p)
	h.publish(protocol.EventProjectUpdated, uuidToString(p.WorkspaceID), "system", "", map[string]any{"project": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ArchiveProjectV12(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID:          pid,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	p, err := h.Queries.ArchiveProjectV12(r.Context(), pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive project")
		return
	}
	resp := projectV12ToResponse(p)
	h.publish(protocol.EventProjectArchived, uuidToString(p.WorkspaceID), "system", "", map[string]any{"project": resp})
	writeJSON(w, http.StatusOK, resp)
}

// ListProjectsByTeamV12 returns projects under a team (used on team detail page).
func (h *Handler) ListProjectsByTeamV12(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	tid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "teamId"), "team id")
	if !ok {
		return
	}
	rows, err := h.Queries.ListProjectsByTeamV12(r.Context(), pgtype.UUID{Bytes: tid.Bytes, Valid: true})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list projects for team")
		return
	}
	// Filter to caller's workspace just in case
	resp := make([]ProjectV12Response, 0, len(rows))
	for _, p := range rows {
		if uuidEqual(p.WorkspaceID, wsUUID) {
			resp = append(resp, projectV12ToResponse(p))
		}
	}
	writeJSON(w, http.StatusOK, ListProjectsV12Response{Projects: resp, Total: len(resp)})
}

// =====================
// Project memory doc append (used by Council adjourn, Mission complete hooks
// once those are extended in Phase E)
// =====================

type AppendMemoryDocRequest struct {
	Section string `json:"section"`
	Body    string `json:"body"`
}

func (h *Handler) AppendProjectMemoryDoc(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	var req AppendMemoryDocRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Body) == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	p, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID:          pid,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	// Naive append: prepend new entry under the section header. A more
	// sophisticated merge lives in the compaction worker; this endpoint is
	// the simple "user/agent dropping a note" path.
	header := req.Section
	if header == "" {
		header = "## 用户钉住的片段"
	}
	newDoc := p.MemoryDoc + "\n\n" + header + "\n" + req.Body + "\n"
	updated, err := h.Queries.UpdateProjectV12(r.Context(), db.UpdateProjectV12Params{
		ID:        pid,
		MemoryDoc: pgtype.Text{String: newDoc, Valid: true},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to append")
		return
	}
	writeJSON(w, http.StatusOK, projectV12ToResponse(updated))
}

// =====================
// Agent project memory
// =====================

type AgentProjectMemoryResponse struct {
	ID                   string  `json:"id"`
	AgentID              string  `json:"agent_id"`
	ProjectID            string  `json:"project_id"`
	Content              string  `json:"content"`
	LastAutoCompactionAt *string `json:"last_auto_compaction_at"`
	CreatedAt            string  `json:"created_at"`
	UpdatedAt            string  `json:"updated_at"`
}

func (h *Handler) ListAgentProjectMemoriesByProject(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID: pid, WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	rows, err := h.Queries.ListAgentProjectMemoriesByProject(r.Context(), pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list memories")
		return
	}
	resp := make([]AgentProjectMemoryResponse, len(rows))
	for i, m := range rows {
		resp[i] = AgentProjectMemoryResponse{
			ID:                   uuidToString(m.ID),
			AgentID:              uuidToString(m.AgentID),
			ProjectID:            uuidToString(m.ProjectID),
			Content:              m.Content,
			LastAutoCompactionAt: timestampToPtr(m.LastAutoCompactionAt),
			CreatedAt:            timestampToString(m.CreatedAt),
			UpdatedAt:            timestampToString(m.UpdatedAt),
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"memories": resp, "total": len(resp)})
}

// =====================
// Project main chat (PRD §17.3 — left-column chat surface)
// =====================
//
// The project's main chat is a chat_session with both team_id and project_id
// set. We reuse the team chat broadcast/dispatch pipeline so the underlying
// daemon doesn't have to know about projects: the captain sees a normal team
// chat task, just like in v1.0/v1.1 team rooms. Messages flow:
//
//   client → POST /api/v12/projects/:id/main-chat/messages
//          → CreateTeamChatMessage
//          → publishTeamMessage(team:message_created, payload includes chat_session_id)
//          → TaskService.EnqueueChatTaskForAgent(captain)
//          → daemon completes → service writes assistant msg → publishes again
//   client receives team:message_created via WS, invalidates by chat_session_id

type ProjectMainChatResponse struct {
	ChatSessionID string  `json:"chat_session_id"`
	ProjectID     string  `json:"project_id"`
	TeamID        string  `json:"team_id"`
	Title         string  `json:"title"`
	Status        string  `json:"status"`
}

func (h *Handler) GetProjectMainChat(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}
	p, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID: pid, WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	session, err := h.ensureProjectMainChat(r.Context(), p, userUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ProjectMainChatResponse{
		ChatSessionID: uuidToString(session.ID),
		ProjectID:     uuidToString(pid),
		TeamID:        uuidToString(session.TeamID),
		Title:         session.Title,
		Status:        session.Status,
	})
}

func (h *Handler) ListProjectMainChatMessages(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}
	p, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID: pid, WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	session, err := h.ensureProjectMainChat(r.Context(), p, userUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
	rows, err := h.Queries.ListChatMessagesBySessionPage(r.Context(), db.ListChatMessagesBySessionPageParams{
		ChatSessionID:   session.ID,
		BeforeCreatedAt: before,
		BeforeID:        beforeID,
		LimitCount:      limit + 1,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list project main chat messages")
		return
	}
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	teamIDStr := uuidToString(session.TeamID)
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

type PostProjectMainChatMessageRequest struct {
	Content string `json:"content"`
}

func (h *Handler) PostProjectMainChatMessage(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}
	var req PostProjectMainChatMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	p, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID: pid, WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	session, err := h.ensureProjectMainChat(r.Context(), p, userUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
	resp := teamMessageToResponse(msg, uuidToString(session.TeamID))
	h.publishTeamMessage(uuidToString(wsUUID), "member", userID, msg, session.TeamID)

	// Dispatch to captain via the same chat-task pipeline as v1.0 team rooms.
	captain, capErr := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
		ID:          h.captainForSession(r.Context(), session),
		WorkspaceID: session.WorkspaceID,
	})
	if capErr != nil || captain.ArchivedAt.Valid {
		h.appendTeamSystemMessage(r, uuidToString(wsUUID), userID, session.ID, session.TeamID, "项目负责人智能体不可用，消息已保留但暂时无法派发。")
		writeJSON(w, http.StatusCreated, resp)
		return
	}
	if _, err := h.TaskService.EnqueueChatTaskForAgent(r.Context(), session, captain.ID); err != nil {
		h.appendTeamSystemMessage(r, uuidToString(wsUUID), userID, session.ID, session.TeamID, "负责人暂时无法接管这条消息："+err.Error())
		writeJSON(w, http.StatusCreated, resp)
		return
	}
	if err := h.Queries.TouchChatSession(r.Context(), session.ID); err != nil {
		// Non-fatal; the message and dispatch already succeeded.
		_ = err
	}
	writeJSON(w, http.StatusCreated, resp)
}

// captainForSession returns the captain agent id for a project main chat
// session by reading it off the bound team. Falls back to a zero UUID on
// error so callers must check ArchivedAt / GetAgent error.
func (h *Handler) captainForSession(ctx context.Context, session db.ChatSession) pgtype.UUID {
	if !session.TeamID.Valid {
		return pgtype.UUID{}
	}
	team, err := h.Queries.GetTeam(ctx, session.TeamID)
	if err != nil {
		return pgtype.UUID{}
	}
	return team.CaptainAgentID
}

// =====================
// Pin to memory (PRD §17.4.2 — 用户钉住片段)
// =====================

type PinChatMessageRequest struct {
	MessageID string `json:"message_id"`
	Note      string `json:"note,omitempty"` // optional user note prepended above the quoted content
}

// PinChatMessageToProjectMemory copies the referenced chat_message into
// project.memory_doc 「## 用户钉住的片段」section. Only messages from this
// project's main chat may be pinned (cross-project pins are rejected) so
// the memory can't accumulate stale references.
func (h *Handler) PinChatMessageToProjectMemory(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	var req PinChatMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	mid, ok := parseUUIDOrBadRequest(w, req.MessageID, "message_id")
	if !ok {
		return
	}
	p, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID: pid, WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	msg, err := h.Queries.GetChatMessage(r.Context(), mid)
	if err != nil {
		writeError(w, http.StatusNotFound, "chat message not found")
		return
	}
	if !p.MainChatSessionID.Valid || !uuidEqual(msg.ChatSessionID, p.MainChatSessionID) {
		writeError(w, http.StatusBadRequest, "message does not belong to this project's main chat")
		return
	}

	stamp := time.Now().Format("2006-01-02 15:04")
	speaker := "用户"
	if msg.Role == "assistant" {
		if msg.SenderAgentID.Valid {
			if a, err := h.Queries.GetAgent(r.Context(), msg.SenderAgentID); err == nil {
				speaker = a.Name
			} else {
				speaker = "Agent"
			}
		} else {
			speaker = "Agent"
		}
	}
	var entry strings.Builder
	fmt.Fprintf(&entry, "- %s · %s 说：\n", stamp, speaker)
	if note := strings.TrimSpace(req.Note); note != "" {
		fmt.Fprintf(&entry, "  > 备注：%s\n", note)
	}
	for _, line := range strings.Split(strings.TrimRight(msg.Content, "\n"), "\n") {
		fmt.Fprintf(&entry, "  > %s\n", line)
	}
	newDoc := appendToMemorySection(p.MemoryDoc, "## 用户钉住的片段", strings.TrimRight(entry.String(), "\n"))
	updated, err := h.Queries.UpdateProjectV12(r.Context(), db.UpdateProjectV12Params{
		ID:                 p.ID,
		MemoryDoc:          pgtype.Text{String: newDoc, Valid: true},
		MemoryDocUpdatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to pin message")
		return
	}
	writeJSON(w, http.StatusOK, projectV12ToResponse(updated))
}

// GetProjectHistory exposes the project's chat history for agent
// onboarding (PRD §17.5.2). Filterable by --since RFC3339 + --limit so
// agents can pull just the slice they need without loading every message
// since project creation.
func (h *Handler) GetProjectHistory(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	p, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID: pid, WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if !p.MainChatSessionID.Valid {
		writeJSON(w, http.StatusOK, ListTeamMessagesResponse{Messages: []TeamMessageResponse{}, NextCursor: nil})
		return
	}
	limit := int32(100)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			writeError(w, http.StatusBadRequest, "invalid limit")
			return
		}
		if n > 500 {
			n = 500
		}
		limit = int32(n)
	}
	var since pgtype.Timestamptz
	if raw := r.URL.Query().Get("since"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid since (expect RFC3339)")
			return
		}
		since = pgtype.Timestamptz{Time: t, Valid: true}
	}
	rows, err := h.Queries.ListChatMessagesBySessionPage(r.Context(), db.ListChatMessagesBySessionPageParams{
		ChatSessionID:   p.MainChatSessionID,
		BeforeCreatedAt: pgtype.Timestamptz{},
		BeforeID:        pgtype.UUID{},
		LimitCount:      limit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list project history")
		return
	}
	// filter by since (server-side; cheap given limit cap)
	teamIDStr := ""
	if p.TeamID.Valid {
		teamIDStr = uuidToString(p.TeamID)
	}
	out := make([]TeamMessageResponse, 0, len(rows))
	for _, m := range rows {
		if since.Valid && m.CreatedAt.Time.Before(since.Time) {
			continue
		}
		out = append(out, teamMessageToResponse(m, teamIDStr))
	}
	// chronological order (ListChatMessagesBySessionPage returns DESC)
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	writeJSON(w, http.StatusOK, ListTeamMessagesResponse{Messages: out, NextCursor: nil})
}

// =====================
// Onboarding hooks (PRD §17.5)
// =====================
//
// When an agent joins (or leaves) a team, post a system "带入消息" to every
// project main chat under that team. Failures are logged but never block the
// underlying team_member write — onboarding is a courtesy, not a contract.

// PostProjectsBroadcastForTeamMemberChange writes a system chat_message into
// every active project main chat under the given team. Used by team member
// add/remove handlers.
func (h *Handler) PostProjectsBroadcastForTeamMemberChange(
	ctx context.Context,
	workspaceID string,
	team db.Team,
	agent db.Agent,
	captainName string,
	verb string, // "joined" / "left"
) {
	projects, err := h.Queries.ListProjectsByTeamV12(ctx, team.ID)
	if err != nil {
		return
	}
	for _, p := range projects {
		if p.Status == "archived" {
			continue
		}
		// Resolve / create the main chat session anchor before writing.
		session, err := h.Queries.GetOrCreateTeamChatSession(ctx, db.GetOrCreateTeamChatSessionParams{
			TeamID:      team.ID,
			WorkspaceID: team.WorkspaceID,
			CreatorID:   pgtype.UUID{},
			Title:       p.Title,
			ProjectID:   pgtype.UUID{Bytes: p.ID.Bytes, Valid: true},
		})
		if err != nil {
			continue
		}
		var content string
		switch verb {
		case "joined":
			content = fmt.Sprintf("【成员变化】%s 加入项目，由 %s 带入。", agent.Name, captainName)
		case "left":
			content = fmt.Sprintf("【成员变化】%s 退出项目。", agent.Name)
		default:
			continue
		}
		msg, err := h.Queries.CreateTeamChatMessage(ctx, db.CreateTeamChatMessageParams{
			ChatSessionID: session.ID,
			Role:          "assistant",
			Content:       content,
		})
		if err != nil {
			continue
		}
		// Append to memory_doc 「团队成员变化」 section so onboarding context
		// is durable across compactions (PRD §17.4.2).
		section := "## 团队成员变化"
		stamp := time.Now().Format("2006-01-02")
		entry := fmt.Sprintf("- %s · %s", stamp, content)
		newDoc := appendToMemorySection(p.MemoryDoc, section, entry)
		_, _ = h.Queries.UpdateProjectV12(ctx, db.UpdateProjectV12Params{
			ID:                 p.ID,
			MemoryDoc:          pgtype.Text{String: newDoc, Valid: true},
			MemoryDocUpdatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		h.publish(protocol.EventTeamMessageCreated, workspaceID, "system", "", map[string]any{
			"team_id":    uuidToString(team.ID),
			"project_id": uuidToString(p.ID),
			"message":    teamMessageToResponse(msg, uuidToString(team.ID)),
		})
	}
}

// appendToMemorySection inserts entry under the markdown section header. If
// the header already exists, the entry is appended at the *top* of that
// section (newest first); otherwise we append a new section to the doc.
// Used by onboarding hooks, council adjourn (Phase E), pin (Phase F), and
// the compaction worker (Phase G).
func appendToMemorySection(doc string, header string, entry string) string {
	header = strings.TrimSpace(header)
	entry = strings.TrimRight(entry, "\n")
	lines := strings.Split(doc, "\n")
	for i, line := range lines {
		if strings.TrimSpace(line) == header {
			// Find the next blank line or next section header
			insertAt := i + 1
			for insertAt < len(lines) {
				next := strings.TrimSpace(lines[insertAt])
				if strings.HasPrefix(next, "## ") {
					break
				}
				insertAt++
			}
			out := append([]string{}, lines[:i+1]...)
			out = append(out, entry)
			out = append(out, lines[i+1:insertAt]...)
			out = append(out, lines[insertAt:]...)
			return strings.Join(out, "\n")
		}
	}
	// Section not found → append a new one
	if doc != "" && !strings.HasSuffix(doc, "\n") {
		doc += "\n"
	}
	if doc != "" {
		doc += "\n"
	}
	return doc + header + "\n" + entry + "\n"
}
