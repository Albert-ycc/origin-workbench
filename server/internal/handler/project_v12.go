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
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// ProjectV12 endpoints (PRD §17 — v1.2 项目工作区).
// Mounted under /api/v12/projects so they don't collide with the legacy v1.0
// /api/projects routes (those still serve issue-classification, kept for
// backwards compat). Frontend code should call ApiClient.listProjectsV12 etc.

type ProjectV12Response struct {
	ID                 string  `json:"id"`
	WorkspaceID        string  `json:"workspace_id"`
	TeamID             *string `json:"team_id"`
	MainChatSessionID  *string `json:"main_chat_session_id"`
	Title              string  `json:"title"`
	Description        string  `json:"description"`
	LocalDir           string  `json:"local_dir"`
	MemoryDoc          string  `json:"memory_doc"`
	MemoryDocUpdatedAt *string `json:"memory_doc_updated_at"`
	CompactionCount    int32   `json:"compaction_count"`
	Status             string  `json:"status"`
	CreatedAt          string  `json:"created_at"`
	UpdatedAt          string  `json:"updated_at"`
}

type ListProjectsV12Response struct {
	Projects []ProjectV12Response `json:"projects"`
	Total    int                  `json:"total"`
}

type CreateProjectV12Request struct {
	// AgentIDs 是项目要拉进来的 agent 列表（含 captain）。后端会按 agent
	// 集合 hash 找现有团队复用，找不到才创建新团队。这是 v1.2 第二轮简化：
	// 用户视角只剩"建项目"一个动作，团队作为 agent 子集自动派生。
	AgentIDs       []string `json:"agent_ids"`
	CaptainAgentID string   `json:"captain_agent_id"`
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
			ID:                p.ID,
			MainChatSessionID: pgtype.UUID{Bytes: session.ID.Bytes, Valid: true},
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
	ChatSessionID string `json:"chat_session_id"`
	ProjectID     string `json:"project_id"`
	TeamID        string `json:"team_id"`
	Title         string `json:"title"`
	Status        string `json:"status"`
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
// Project compaction (PRD §17.4.5 — /sync 模式主聊压缩)
// =====================
//
// 五步流程实施 v1.0：
//   preview 跑 1-3 步（盘点 → 规则化压缩草稿 → 候选 pinned_quotes），返
//   回给前端面板让用户编辑确认。confirm 接收用户编辑过的草稿，跑 4-5
//   步（写 memory_doc → 归档旧会话 + compacted_into_session_id → 新建空
//   主聊 → 摘要 system 消息）。
//
// 简化点：本轮不接 captain LLM 调用。Preview 草稿用规则方法生成（按
// pinned 已写入的内容、council 散会结论、用户消息频率等）。智能压缩
// 留 v1.3，标记成 follow-up。User 在 preview 面板可手动修改草稿，确认
// 写入。
//
// 边界：
//   - 24 小时内已压缩过的项目拒绝二次压缩（PRD §17.4.5）
//   - 单聊（project_id IS NULL）不在本路径，单聊压缩留 v1.3
//   - 失败任一步：旧 chat_session 不归档；返回错误，前端 toast

const projectCompactionCooldown = 24 * time.Hour

type CompactionPreviewResponse struct {
	KeyDecisions     []string      `json:"key_decisions"`
	Deliverables     []string      `json:"deliverables"`
	CurrentStatus    string        `json:"current_status"`
	CarryForward     []string      `json:"carry_forward"`
	PinnedCandidates []PinnedQuote `json:"pinned_candidates"`
	MessageCount     int           `json:"message_count"`
	OldestAt         string        `json:"oldest_at,omitempty"`
	NewestAt         string        `json:"newest_at,omitempty"`
}

type PinnedQuote struct {
	MessageID string `json:"message_id"`
	Speaker   string `json:"speaker"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

type projectCompactionScope struct {
	Project  db.Project
	Session  db.ChatSession
	Messages []db.ChatMessage
}

type projectCompactionLoadError struct {
	status  int
	message string
}

func (e projectCompactionLoadError) Error() string { return e.message }

func (h *Handler) PreviewProjectCompaction(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	scope, loadErr := h.loadProjectCompactionScope(r.Context(), wsUUID, pid)
	if loadErr != nil {
		writeError(w, loadErr.status, loadErr.message)
		return
	}
	resp := h.buildRuleProjectCompactionPreview(r.Context(), scope)
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) loadProjectCompactionScope(ctx context.Context, wsUUID, pid pgtype.UUID) (projectCompactionScope, *projectCompactionLoadError) {
	p, err := h.Queries.GetProjectInWorkspaceV12(ctx, db.GetProjectInWorkspaceV12Params{
		ID: pid, WorkspaceID: wsUUID,
	})
	if err != nil {
		return projectCompactionScope{}, &projectCompactionLoadError{status: http.StatusNotFound, message: "project not found"}
	}
	if !p.MainChatSessionID.Valid {
		return projectCompactionScope{}, &projectCompactionLoadError{status: http.StatusBadRequest, message: "project has no main chat session"}
	}
	session, err := h.Queries.GetChatSession(ctx, p.MainChatSessionID)
	if err != nil {
		return projectCompactionScope{}, &projectCompactionLoadError{status: http.StatusInternalServerError, message: "failed to load main chat"}
	}
	if session.LastCompactedAt.Valid && time.Since(session.LastCompactedAt.Time) < projectCompactionCooldown {
		return projectCompactionScope{}, &projectCompactionLoadError{
			status:  http.StatusTooEarly,
			message: fmt.Sprintf("project was compacted %s ago — please wait at least 24h", time.Since(session.LastCompactedAt.Time).Round(time.Minute)),
		}
	}
	rows, err := h.Queries.ListChatMessages(ctx, session.ID)
	if err != nil {
		return projectCompactionScope{}, &projectCompactionLoadError{status: http.StatusInternalServerError, message: "failed to list messages"}
	}
	cutoff := time.Now().Add(-30 * time.Minute)
	inWindow := make([]db.ChatMessage, 0, len(rows))
	for _, m := range rows {
		if !m.CreatedAt.Valid || m.CreatedAt.Time.Before(cutoff) {
			inWindow = append(inWindow, m)
		}
	}
	return projectCompactionScope{Project: p, Session: session, Messages: inWindow}, nil
}

func (h *Handler) buildRuleProjectCompactionPreview(ctx context.Context, scope projectCompactionScope) CompactionPreviewResponse {
	resp := CompactionPreviewResponse{
		KeyDecisions:     []string{},
		Deliverables:     []string{},
		CarryForward:     []string{},
		PinnedCandidates: []PinnedQuote{},
		MessageCount:     len(scope.Messages),
	}
	if len(scope.Messages) > 0 {
		if scope.Messages[0].CreatedAt.Valid {
			resp.OldestAt = scope.Messages[0].CreatedAt.Time.Format(time.RFC3339)
		}
		if last := scope.Messages[len(scope.Messages)-1]; last.CreatedAt.Valid {
			resp.NewestAt = last.CreatedAt.Time.Format(time.RFC3339)
		}
	}
	if resp.MessageCount > 0 {
		resp.CurrentStatus = fmt.Sprintf("最近活跃于 %s — 共 %d 条消息待整理", resp.NewestAt, resp.MessageCount)
	} else {
		resp.CurrentStatus = "暂无新消息可整理"
	}

	type cand struct {
		m db.ChatMessage
	}
	var cands []cand
	for _, m := range scope.Messages {
		if m.Role == "assistant" && len([]rune(m.Content)) >= 80 {
			cands = append(cands, cand{m})
		}
	}
	if len(cands) > 5 {
		cands = cands[len(cands)-5:]
	}
	for _, c := range cands {
		resp.PinnedCandidates = append(resp.PinnedCandidates, h.chatMessageToPinnedQuote(ctx, c.m))
	}
	return resp
}

func (h *Handler) chatMessageToPinnedQuote(ctx context.Context, m db.ChatMessage) PinnedQuote {
	speaker := "Agent"
	if m.Role == "user" {
		speaker = "用户"
	} else if m.SenderAgentID.Valid {
		if a, err := h.Queries.GetAgent(ctx, m.SenderAgentID); err == nil {
			speaker = a.Name
		}
	}
	quote := PinnedQuote{
		MessageID: uuidToString(m.ID),
		Speaker:   speaker,
		Content:   m.Content,
	}
	if m.CreatedAt.Valid {
		quote.CreatedAt = m.CreatedAt.Time.Format(time.RFC3339)
	}
	return quote
}

const projectCompactionMaxMessageRunes = 4000

type StartProjectCompactionPreviewResponse struct {
	TaskID          string                    `json:"task_id"`
	Status          string                    `json:"status"`
	FallbackPreview CompactionPreviewResponse `json:"fallback_preview"`
}

type ProjectCompactionPreviewJobResponse struct {
	TaskID          string                     `json:"task_id"`
	Status          string                     `json:"status"`
	Preview         *CompactionPreviewResponse `json:"preview,omitempty"`
	FallbackPreview CompactionPreviewResponse  `json:"fallback_preview"`
	Error           string                     `json:"error,omitempty"`
}

func (h *Handler) StartProjectCompactionPreviewJob(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	scope, loadErr := h.loadProjectCompactionScope(r.Context(), wsUUID, pid)
	if loadErr != nil {
		writeError(w, loadErr.status, loadErr.message)
		return
	}
	if !scope.Project.TeamID.Valid {
		writeError(w, http.StatusBadRequest, "project is not bound to a team")
		return
	}
	team, err := h.Queries.GetTeam(r.Context(), scope.Project.TeamID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load project team")
		return
	}
	task, err := h.TaskService.EnqueueProjectCompactionTask(r.Context(), wsUUID, pid, scope.Session.ID, team.CaptainAgentID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, StartProjectCompactionPreviewResponse{
		TaskID:          uuidToString(task.ID),
		Status:          task.Status,
		FallbackPreview: h.buildRuleProjectCompactionPreview(r.Context(), scope),
	})
}

func (h *Handler) GetProjectCompactionPreviewJob(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	pid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "project id")
	if !ok {
		return
	}
	taskID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "taskId"), "task id")
	if !ok {
		return
	}
	task, err := h.Queries.GetAgentTask(r.Context(), taskID)
	if err != nil {
		writeError(w, http.StatusNotFound, "preview job not found")
		return
	}
	pc, ok := parseProjectCompactionContext(task)
	if !ok || pc.ProjectID != uuidToString(pid) || pc.WorkspaceID != uuidToString(wsUUID) {
		writeError(w, http.StatusNotFound, "preview job not found")
		return
	}
	scope, loadErr := h.loadProjectCompactionScope(r.Context(), wsUUID, pid)
	if loadErr != nil {
		writeError(w, loadErr.status, loadErr.message)
		return
	}
	fallback := h.buildRuleProjectCompactionPreview(r.Context(), scope)
	resp := ProjectCompactionPreviewJobResponse{
		TaskID:          uuidToString(task.ID),
		Status:          task.Status,
		FallbackPreview: fallback,
	}
	switch task.Status {
	case "completed":
		output := taskResultOutput(task.Result)
		preview, err := h.previewFromCompactionOutput(r.Context(), scope, output, fallback)
		if err != nil {
			resp.Preview = &fallback
			resp.Error = err.Error()
		} else {
			resp.Preview = &preview
		}
	case "failed", "cancelled":
		resp.Error = "captain preview job " + task.Status
		if task.Error.Valid {
			resp.Error = task.Error.String
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func parseProjectCompactionContext(task db.AgentTaskQueue) (service.ProjectCompactionContext, bool) {
	if task.IssueID.Valid || task.ChatSessionID.Valid || task.AutopilotRunID.Valid || len(task.Context) == 0 {
		return service.ProjectCompactionContext{}, false
	}
	var pc service.ProjectCompactionContext
	if err := json.Unmarshal(task.Context, &pc); err != nil {
		return service.ProjectCompactionContext{}, false
	}
	return pc, pc.Type == service.ProjectCompactionContextType
}

func (h *Handler) buildProjectCompactionTaskData(ctx context.Context, pc service.ProjectCompactionContext) (*ProjectCompactionTaskData, error) {
	wsUUID, ok := parseUUID2(pc.WorkspaceID)
	if !ok {
		return nil, fmt.Errorf("invalid workspace_id")
	}
	pid, ok := parseUUID2(pc.ProjectID)
	if !ok {
		return nil, fmt.Errorf("invalid project_id")
	}
	scope, loadErr := h.loadProjectCompactionScope(ctx, wsUUID, pid)
	if loadErr != nil {
		return nil, loadErr
	}
	if uuidToString(scope.Session.ID) != pc.ChatSessionID {
		return nil, fmt.Errorf("project main chat changed")
	}
	data := &ProjectCompactionTaskData{
		ProjectID:     pc.ProjectID,
		ProjectTitle:  scope.Project.Title,
		ChatSessionID: pc.ChatSessionID,
		MemoryDoc:     scope.Project.MemoryDoc,
		MessageCount:  len(scope.Messages),
		Messages:      make([]ProjectCompactionTaskMessage, 0, len(scope.Messages)),
	}
	if len(scope.Messages) > 0 {
		if scope.Messages[0].CreatedAt.Valid {
			data.OldestAt = scope.Messages[0].CreatedAt.Time.Format(time.RFC3339)
		}
		if last := scope.Messages[len(scope.Messages)-1]; last.CreatedAt.Valid {
			data.NewestAt = last.CreatedAt.Time.Format(time.RFC3339)
		}
	}
	for _, m := range scope.Messages {
		quote := h.chatMessageToPinnedQuote(ctx, m)
		data.Messages = append(data.Messages, ProjectCompactionTaskMessage{
			ID:        uuidToString(m.ID),
			Role:      m.Role,
			Speaker:   quote.Speaker,
			Content:   truncateRunes(m.Content, projectCompactionMaxMessageRunes),
			CreatedAt: quote.CreatedAt,
		})
	}
	return data, nil
}

type compactionDraft struct {
	KeyDecisions     []string `json:"key_decisions"`
	Deliverables     []string `json:"deliverables"`
	CurrentStatus    string   `json:"current_status"`
	CarryForward     []string `json:"carry_forward"`
	PinnedMessageIDs []string `json:"pinned_message_ids"`
}

func taskResultOutput(raw []byte) string {
	var payload struct {
		Output string `json:"output"`
	}
	_ = json.Unmarshal(raw, &payload)
	return payload.Output
}

func parseCompactionDraftOutput(output string) (compactionDraft, error) {
	var draft compactionDraft
	raw := strings.TrimSpace(output)
	if raw == "" {
		return draft, fmt.Errorf("captain returned empty output")
	}
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end < start {
		return draft, fmt.Errorf("captain output did not contain a JSON object")
	}
	if err := json.Unmarshal([]byte(raw[start:end+1]), &draft); err != nil {
		return draft, fmt.Errorf("failed to parse captain JSON: %w", err)
	}
	return draft, nil
}

func (h *Handler) previewFromCompactionOutput(ctx context.Context, scope projectCompactionScope, output string, fallback CompactionPreviewResponse) (CompactionPreviewResponse, error) {
	draft, err := parseCompactionDraftOutput(output)
	if err != nil {
		return fallback, err
	}
	preview := fallback
	if list := cleanCompactionStringList(draft.KeyDecisions); list != nil {
		preview.KeyDecisions = list
	}
	if list := cleanCompactionStringList(draft.Deliverables); list != nil {
		preview.Deliverables = list
	}
	if list := cleanCompactionStringList(draft.CarryForward); list != nil {
		preview.CarryForward = list
	}
	if s := strings.TrimSpace(draft.CurrentStatus); s != "" {
		preview.CurrentStatus = s
	}
	if pins := h.pinnedQuotesByIDs(ctx, scope.Messages, draft.PinnedMessageIDs); len(pins) > 0 {
		preview.PinnedCandidates = pins
	}
	return preview, nil
}

func cleanCompactionStringList(values []string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func (h *Handler) pinnedQuotesByIDs(ctx context.Context, messages []db.ChatMessage, ids []string) []PinnedQuote {
	byID := make(map[string]db.ChatMessage, len(messages))
	for _, m := range messages {
		byID[uuidToString(m.ID)] = m
	}
	out := make([]PinnedQuote, 0, len(ids))
	seen := map[string]bool{}
	for _, raw := range ids {
		id := strings.TrimSpace(raw)
		if id == "" || seen[id] {
			continue
		}
		m, ok := byID[id]
		if !ok {
			continue
		}
		out = append(out, h.chatMessageToPinnedQuote(ctx, m))
		seen[id] = true
		if len(out) >= 8 {
			break
		}
	}
	return out
}

func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	rs := []rune(s)
	if len(rs) <= max {
		return s
	}
	return string(rs[:max]) + "..."
}

type ConfirmProjectCompactionRequest struct {
	KeyDecisions   []string `json:"key_decisions"`
	Deliverables   []string `json:"deliverables"`
	CurrentStatus  string   `json:"current_status"`
	CarryForward   []string `json:"carry_forward"`
	SelectedPinIDs []string `json:"selected_pin_ids"` // subset of pinned_candidates message_ids
}

type ConfirmProjectCompactionResponse struct {
	Project           ProjectV12Response `json:"project"`
	NewChatSessionID  string             `json:"new_chat_session_id"`
	ArchivedSessionID string             `json:"archived_session_id"`
}

func (h *Handler) ConfirmProjectCompaction(w http.ResponseWriter, r *http.Request) {
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
	var req ConfirmProjectCompactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	p, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID: pid, WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if !p.MainChatSessionID.Valid || !p.TeamID.Valid {
		writeError(w, http.StatusBadRequest, "project is not bound to a main chat / team")
		return
	}
	oldSession, err := h.Queries.GetChatSession(r.Context(), p.MainChatSessionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load old session")
		return
	}

	// Step 3: rewrite memory_doc with the user-confirmed draft.
	now := time.Now()
	stamp := now.Format("2006-01-02")
	doc := p.MemoryDoc
	for _, d := range req.KeyDecisions {
		if s := strings.TrimSpace(d); s != "" {
			doc = appendToMemorySection(doc, "## 关键决策", fmt.Sprintf("- %s · %s", stamp, s))
		}
	}
	for _, d := range req.Deliverables {
		if s := strings.TrimSpace(d); s != "" {
			doc = appendToMemorySection(doc, "## 主要产出", fmt.Sprintf("- %s · %s", stamp, s))
		}
	}
	if cs := strings.TrimSpace(req.CurrentStatus); cs != "" {
		// CurrentStatus replaces the section body rather than appends — it's a
		// snapshot of "now", not a journal.
		doc = replaceMemorySection(doc, "## 当前状态", cs)
	}
	// Selected pinned quotes: copy content to 「## 用户钉住的片段」 if not
	// already pinned. This is best-effort dedupe by message_id (we just look
	// the message up and re-pin in standard format).
	for _, mid := range req.SelectedPinIDs {
		mUUID, ok := parseUUID2(mid)
		if !ok {
			continue
		}
		msg, err := h.Queries.GetChatMessage(r.Context(), mUUID)
		if err != nil {
			continue
		}
		speaker := "Agent"
		if msg.Role == "user" {
			speaker = "用户"
		} else if msg.SenderAgentID.Valid {
			if a, err := h.Queries.GetAgent(r.Context(), msg.SenderAgentID); err == nil {
				speaker = a.Name
			}
		}
		var entry strings.Builder
		fmt.Fprintf(&entry, "- %s · %s 说：", stamp, speaker)
		for _, line := range strings.Split(strings.TrimRight(msg.Content, "\n"), "\n") {
			fmt.Fprintf(&entry, "\n  > %s", line)
		}
		doc = appendToMemorySection(doc, "## 用户钉住的片段", entry.String())
	}

	// Step 4: archive old session FIRST so the (team_id, project_id) unique
	// slot is freed (the partial index requires status='active'), then
	// GetOrCreate picks an INSERT path producing a fresh row.
	// We stamp the compaction pointer in two writes — initial archive, then
	// fill the pointer once the new session id is known. Two writes is fine:
	// the pointer is a UX convenience for the archived sessions tab, not a
	// integrity guarantee.
	if err := h.Queries.ArchiveChatSession(r.Context(), oldSession.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive old session: "+err.Error())
		return
	}
	newSession, err := h.Queries.GetOrCreateTeamChatSession(r.Context(), db.GetOrCreateTeamChatSessionParams{
		TeamID:      p.TeamID,
		WorkspaceID: p.WorkspaceID,
		CreatorID:   userUUID,
		Title:       p.Title,
		ProjectID:   pgtype.UUID{Bytes: p.ID.Bytes, Valid: true},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create new main chat: "+err.Error())
		return
	}
	if uuidEqual(newSession.ID, oldSession.ID) {
		writeError(w, http.StatusInternalServerError, "compaction failed: archive did not free unique slot")
		return
	}
	// Fill the compaction pointer + last_compacted_at on the just-archived
	// row so right-rail "归档会话" tab can thread back to the new session.
	if err := h.Queries.ArchiveChatSessionWithCompactionPointer(r.Context(), db.ArchiveChatSessionWithCompactionPointerParams{
		ID:                     oldSession.ID,
		CompactedIntoSessionID: pgtype.UUID{Bytes: newSession.ID.Bytes, Valid: true},
	}); err != nil {
		// non-fatal: the archive itself succeeded, the pointer is cosmetic
		_ = err
	}

	// Move the project's anchor to the new session.
	if err := h.Queries.ReplaceProjectMainChatSessionV12(r.Context(), db.ReplaceProjectMainChatSessionV12Params{
		ID:                p.ID,
		MainChatSessionID: pgtype.UUID{Bytes: newSession.ID.Bytes, Valid: true},
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to swap main chat anchor: "+err.Error())
		return
	}

	// Persist memory_doc + compaction_count.
	updated, err := h.Queries.UpdateProjectV12(r.Context(), db.UpdateProjectV12Params{
		ID:                 p.ID,
		MemoryDoc:          pgtype.Text{String: doc, Valid: true},
		MemoryDocUpdatedAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write memory_doc: "+err.Error())
		return
	}
	if _, err := h.Queries.IncrementProjectCompactionV12(r.Context(), p.ID); err != nil {
		// non-fatal: counter drift is cosmetic
		_ = err
	}

	// Step 4 cont.: write opening system message into the new session
	opening := fmt.Sprintf("【本项目记忆已更新（基于压缩第 %d 次）】", updated.CompactionCount+1)
	if cs := strings.TrimSpace(req.CurrentStatus); cs != "" {
		opening += "\n当前状态：" + cs
	}
	if len(req.CarryForward) > 0 {
		opening += "\n待跟进："
		for _, c := range req.CarryForward {
			if cc := strings.TrimSpace(c); cc != "" {
				opening += "\n- " + cc
			}
		}
	}
	opening += "\n\n完整记忆 → 见右栏「项目记忆文档」 Tab。"
	if _, err := h.Queries.CreateTeamChatMessage(r.Context(), db.CreateTeamChatMessageParams{
		ChatSessionID: newSession.ID,
		Role:          "assistant",
		Content:       opening,
	}); err != nil {
		// non-fatal; the new session exists, the opening message can be re-
		// posted manually.
		_ = err
	}

	writeJSON(w, http.StatusOK, ConfirmProjectCompactionResponse{
		Project:           projectV12ToResponse(updated),
		NewChatSessionID:  uuidToString(newSession.ID),
		ArchivedSessionID: uuidToString(oldSession.ID),
	})
}

// replaceMemorySection swaps the body of the named section. If the section
// doesn't exist, append a new one. Used for "## 当前状态" which is a
// snapshot rather than an append-only journal.
func replaceMemorySection(doc string, header string, body string) string {
	header = strings.TrimSpace(header)
	body = strings.TrimRight(body, "\n")
	lines := strings.Split(doc, "\n")
	for i, line := range lines {
		if strings.TrimSpace(line) == header {
			// find end of this section
			end := i + 1
			for end < len(lines) {
				next := strings.TrimSpace(lines[end])
				if strings.HasPrefix(next, "## ") {
					break
				}
				end++
			}
			out := append([]string{}, lines[:i+1]...)
			out = append(out, body)
			out = append(out, lines[end:]...)
			return strings.Join(out, "\n")
		}
	}
	if doc != "" && !strings.HasSuffix(doc, "\n") {
		doc += "\n"
	}
	if doc != "" {
		doc += "\n"
	}
	return doc + header + "\n" + body + "\n"
}

func parseUUID2(s string) (pgtype.UUID, bool) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return u, false
	}
	return u, true
}

func (h *Handler) ListProjectArchivedSessions(w http.ResponseWriter, r *http.Request) {
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
	rows, err := h.Queries.ListArchivedChatSessionsByProject(r.Context(), pgtype.UUID{Bytes: pid.Bytes, Valid: true})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list archived sessions")
		return
	}
	type archivedRow struct {
		ID                     string  `json:"id"`
		Title                  string  `json:"title"`
		LastCompactedAt        *string `json:"last_compacted_at"`
		CompactedIntoSessionID *string `json:"compacted_into_session_id"`
		CreatedAt              string  `json:"created_at"`
	}
	out := make([]archivedRow, 0, len(rows))
	for _, s := range rows {
		row := archivedRow{
			ID:        uuidToString(s.ID),
			Title:     s.Title,
			CreatedAt: timestampToString(s.CreatedAt),
		}
		if s.LastCompactedAt.Valid {
			ts := s.LastCompactedAt.Time.Format(time.RFC3339)
			row.LastCompactedAt = &ts
		}
		if s.CompactedIntoSessionID.Valid {
			cid := uuidToString(s.CompactedIntoSessionID)
			row.CompactedIntoSessionID = &cid
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out, "total": len(out)})
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
