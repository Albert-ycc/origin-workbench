package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
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
	resp := projectV12ToResponse(p)
	h.publish(protocol.EventProjectCreated, uuidToString(p.WorkspaceID), "system", "", map[string]any{"project": resp})
	writeJSON(w, http.StatusCreated, resp)
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
