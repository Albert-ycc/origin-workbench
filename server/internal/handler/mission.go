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

type MissionResponse struct {
	ID              string `json:"id"`
	WorkspaceID     string `json:"workspace_id"`
	TeamID          string `json:"team_id"`
	CaptainAgentID  string `json:"captain_agent_id"`
	ChatSessionID   string `json:"chat_session_id"`
	CreatedByUserID string `json:"created_by_user_id"`
	Title           string `json:"title"`
	Prompt          string `json:"prompt"`
	Summary         string `json:"summary"`
	Outcome         string `json:"outcome"`
	Status          string `json:"status"`
	RiskLevel       string `json:"risk_level"`
	ExecutionMode   string `json:"execution_mode"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

type MissionPlanItemResponse struct {
	ID              string  `json:"id"`
	MissionID       string  `json:"mission_id"`
	ParentID        *string `json:"parent_id"`
	Title           string  `json:"title"`
	Description     string  `json:"description"`
	Phase           string  `json:"phase"`
	Status          string  `json:"status"`
	Priority        string  `json:"priority"`
	RiskLevel       string  `json:"risk_level"`
	AssignedAgentID *string `json:"assigned_agent_id"`
	IssueID         *string `json:"issue_id"`
	SortOrder       int32   `json:"sort_order"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
}

type MissionAssignmentResponse struct {
	ID         string  `json:"id"`
	MissionID  string  `json:"mission_id"`
	PlanItemID *string `json:"plan_item_id"`
	AgentID    string  `json:"agent_id"`
	Status     string  `json:"status"`
	RiskLevel  string  `json:"risk_level"`
	TaskID     *string `json:"task_id"`
	IssueID    *string `json:"issue_id"`
	Output     string  `json:"output"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
}

type MissionEventResponse struct {
	ID          string          `json:"id"`
	MissionID   string          `json:"mission_id"`
	WorkspaceID string          `json:"workspace_id"`
	ActorType   string          `json:"actor_type"`
	ActorID     *string         `json:"actor_id"`
	Kind        string          `json:"kind"`
	Title       string          `json:"title"`
	Body        string          `json:"body"`
	Payload     json.RawMessage `json:"payload"`
	CreatedAt   string          `json:"created_at"`
}

type MissionDetailResponse struct {
	Mission     MissionResponse             `json:"mission"`
	PlanItems   []MissionPlanItemResponse   `json:"plan_items"`
	Assignments []MissionAssignmentResponse `json:"assignments"`
	Events      []MissionEventResponse      `json:"events"`
	Team        TeamResponse                `json:"team"`
}

type ListMissionsResponse struct {
	Missions []MissionResponse `json:"missions"`
	Total    int               `json:"total"`
}

type CreateMissionPlanItemRequest struct {
	Title           string  `json:"title"`
	Description     string  `json:"description"`
	Phase           string  `json:"phase"`
	Priority        string  `json:"priority"`
	RiskLevel       string  `json:"risk_level"`
	AssignedAgentID *string `json:"assigned_agent_id"`
}

type CreateMissionRequest struct {
	Title          string                         `json:"title"`
	Prompt         string                         `json:"prompt"`
	Summary        string                         `json:"summary"`
	Outcome        string                         `json:"outcome"`
	TeamID         string                         `json:"team_id"`
	CaptainAgentID string                         `json:"captain_agent_id"`
	MemberAgentIDs []string                       `json:"member_agent_ids"`
	RiskLevel      string                         `json:"risk_level"`
	ExecutionMode  string                         `json:"execution_mode"`
	PlanItems      []CreateMissionPlanItemRequest `json:"plan_items"`
}

type UpdateMissionRequest struct {
	Title          *string `json:"title"`
	Summary        *string `json:"summary"`
	Outcome        *string `json:"outcome"`
	Status         *string `json:"status"`
	RiskLevel      *string `json:"risk_level"`
	ExecutionMode  *string `json:"execution_mode"`
	TeamID         *string `json:"team_id"`
	CaptainAgentID *string `json:"captain_agent_id"`
}

func missionToResponse(m db.Mission) MissionResponse {
	return MissionResponse{
		ID:              uuidToString(m.ID),
		WorkspaceID:     uuidToString(m.WorkspaceID),
		TeamID:          uuidToString(m.TeamID),
		CaptainAgentID:  uuidToString(m.CaptainAgentID),
		ChatSessionID:   uuidToString(m.ChatSessionID),
		CreatedByUserID: uuidToString(m.CreatedByUserID),
		Title:           m.Title,
		Prompt:          m.Prompt,
		Summary:         m.Summary,
		Outcome:         m.Outcome,
		Status:          m.Status,
		RiskLevel:       m.RiskLevel,
		ExecutionMode:   m.ExecutionMode,
		CreatedAt:       timestampToString(m.CreatedAt),
		UpdatedAt:       timestampToString(m.UpdatedAt),
	}
}

func missionPlanItemToResponse(item db.MissionPlanItem) MissionPlanItemResponse {
	return MissionPlanItemResponse{
		ID:              uuidToString(item.ID),
		MissionID:       uuidToString(item.MissionID),
		ParentID:        uuidToPtr(item.ParentID),
		Title:           item.Title,
		Description:     item.Description,
		Phase:           item.Phase,
		Status:          item.Status,
		Priority:        item.Priority,
		RiskLevel:       item.RiskLevel,
		AssignedAgentID: uuidToPtr(item.AssignedAgentID),
		IssueID:         uuidToPtr(item.IssueID),
		SortOrder:       item.SortOrder,
		CreatedAt:       timestampToString(item.CreatedAt),
		UpdatedAt:       timestampToString(item.UpdatedAt),
	}
}

func missionAssignmentToResponse(a db.MissionAssignment) MissionAssignmentResponse {
	return MissionAssignmentResponse{
		ID:         uuidToString(a.ID),
		MissionID:  uuidToString(a.MissionID),
		PlanItemID: uuidToPtr(a.PlanItemID),
		AgentID:    uuidToString(a.AgentID),
		Status:     a.Status,
		RiskLevel:  a.RiskLevel,
		TaskID:     uuidToPtr(a.TaskID),
		IssueID:    uuidToPtr(a.IssueID),
		Output:     a.Output,
		CreatedAt:  timestampToString(a.CreatedAt),
		UpdatedAt:  timestampToString(a.UpdatedAt),
	}
}

func missionEventToResponse(e db.MissionEvent) MissionEventResponse {
	payload := json.RawMessage(e.Payload)
	if len(payload) == 0 {
		payload = json.RawMessage("{}")
	}
	return MissionEventResponse{
		ID:          uuidToString(e.ID),
		MissionID:   uuidToString(e.MissionID),
		WorkspaceID: uuidToString(e.WorkspaceID),
		ActorType:   e.ActorType,
		ActorID:     uuidToPtr(e.ActorID),
		Kind:        e.Kind,
		Title:       e.Title,
		Body:        e.Body,
		Payload:     payload,
		CreatedAt:   timestampToString(e.CreatedAt),
	}
}

func missionDetailToResponse(m db.Mission, team db.Team, members []db.TeamMember, plan []db.MissionPlanItem, assignments []db.MissionAssignment, events []db.MissionEvent) MissionDetailResponse {
	planResp := make([]MissionPlanItemResponse, len(plan))
	for i, item := range plan {
		planResp[i] = missionPlanItemToResponse(item)
	}
	assignmentResp := make([]MissionAssignmentResponse, len(assignments))
	for i, assignment := range assignments {
		assignmentResp[i] = missionAssignmentToResponse(assignment)
	}
	eventResp := make([]MissionEventResponse, len(events))
	for i, event := range events {
		eventResp[i] = missionEventToResponse(event)
	}
	return MissionDetailResponse{
		Mission:     missionToResponse(m),
		PlanItems:   planResp,
		Assignments: assignmentResp,
		Events:      eventResp,
		Team:        teamToResponse(team, members),
	}
}

func (h *Handler) loadMissionDetail(w http.ResponseWriter, r *http.Request, id string) (db.Mission, db.Team, []db.TeamMember, []db.MissionPlanItem, []db.MissionAssignment, []db.MissionEvent, bool) {
	workspaceID := h.resolveWorkspaceID(r)
	missionUUID, ok := parseUUIDOrBadRequest(w, id, "mission id")
	if !ok {
		return db.Mission{}, db.Team{}, nil, nil, nil, nil, false
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return db.Mission{}, db.Team{}, nil, nil, nil, nil, false
	}

	mission, err := h.Queries.GetMissionInWorkspace(r.Context(), db.GetMissionInWorkspaceParams{
		ID:          missionUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "mission not found")
		return db.Mission{}, db.Team{}, nil, nil, nil, nil, false
	}
	team, err := h.Queries.GetTeamInWorkspace(r.Context(), db.GetTeamInWorkspaceParams{
		ID:          mission.TeamID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "mission team not found")
		return db.Mission{}, db.Team{}, nil, nil, nil, nil, false
	}
	members := h.listTeamMembersOrEmpty(r, team.ID)
	plan, _ := h.Queries.ListMissionPlanItems(r.Context(), mission.ID)
	assignments, _ := h.Queries.ListMissionAssignments(r.Context(), mission.ID)
	events, _ := h.Queries.ListMissionEvents(r.Context(), mission.ID)
	return mission, team, members, plan, assignments, events, true
}

func validateMissionStatus(status string) bool {
	switch status {
	case "draft", "planning", "waiting_confirmation", "executing", "blocked", "completed", "archived":
		return true
	default:
		return false
	}
}

func normalizeRiskLevel(raw string) string {
	switch raw {
	case "medium", "high":
		return raw
	default:
		return "low"
	}
}

func normalizeExecutionMode(raw string) string {
	switch raw {
	case "confirm", "step_confirm":
		return raw
	default:
		return "auto"
	}
}

func normalizeMissionPhase(raw string) string {
	switch raw {
	case "plan", "verify", "ship":
		return raw
	default:
		return "execute"
	}
}

func normalizeMissionPriority(raw string) string {
	switch raw {
	case "high", "low":
		return raw
	default:
		return "medium"
	}
}

func missionTitleFromPrompt(prompt string) string {
	trimmed := strings.TrimSpace(prompt)
	if trimmed == "" {
		return "未命名任务"
	}
	split := strings.FieldsFunc(trimmed, func(r rune) bool {
		return r == '。' || r == '.' || r == '!' || r == '?' || r == '\n'
	})
	title := strings.TrimSpace(trimmed)
	if len(split) > 0 && strings.TrimSpace(split[0]) != "" {
		title = strings.TrimSpace(split[0])
	}
	runes := []rune(title)
	if len(runes) > 42 {
		return string(runes[:42]) + "..."
	}
	return title
}

func defaultMissionPlanItems(prompt string, captainID string, memberIDs []string) []CreateMissionPlanItemRequest {
	memberFor := func(index int) *string {
		if len(memberIDs) == 0 {
			if captainID == "" {
				return nil
			}
			v := captainID
			return &v
		}
		v := memberIDs[index%len(memberIDs)]
		return &v
	}
	return []CreateMissionPlanItemRequest{
		{
			Title:           "负责人拆解目标和验收标准",
			Description:     "把用户目标转成清晰的计划树、关键假设、验收标准和风险确认点。\n\n原始目标：" + strings.TrimSpace(prompt),
			Phase:           "plan",
			Priority:        "high",
			RiskLevel:       "low",
			AssignedAgentID: func() *string { v := captainID; return &v }(),
		},
		{
			Title:           "成员执行第一批子任务",
			Description:     "由负责人按团队成员能力分派执行任务，成员在群聊里回传过程、结论和阻塞。",
			Phase:           "execute",
			Priority:        "high",
			RiskLevel:       "low",
			AssignedAgentID: memberFor(0),
		},
		{
			Title:           "复核结果并沉淀记忆候选",
			Description:     "检查交付结果、记录风险、生成复盘摘要、记忆候选和技能候选。",
			Phase:           "verify",
			Priority:        "medium",
			RiskLevel:       "medium",
			AssignedAgentID: memberFor(1),
		},
	}
}

func missionBrief(title, prompt string, plan []db.MissionPlanItem) string {
	var b strings.Builder
	b.WriteString("【Origin Mission】")
	b.WriteString(title)
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
	b.WriteString("\n\n请你作为团队负责人，先拆解任务，明确需要哪些成员协作；如果需要成员参与，请在群聊中 @成员名 分派具体子任务。中高风险动作先向用户确认。")
	return b.String()
}

func eventPayload(value map[string]any) []byte {
	payload, err := json.Marshal(value)
	if err != nil {
		return []byte("{}")
	}
	return payload
}

func (h *Handler) ListMissions(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	var missions []db.Mission
	var err error
	if r.URL.Query().Get("status") == "archived" {
		missions, err = h.Queries.ListArchivedMissions(r.Context(), wsUUID)
	} else {
		missions, err = h.Queries.ListMissions(r.Context(), wsUUID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list missions")
		return
	}

	resp := make([]MissionResponse, len(missions))
	for i, mission := range missions {
		resp[i] = missionToResponse(mission)
	}
	writeJSON(w, http.StatusOK, ListMissionsResponse{Missions: resp, Total: len(resp)})
}

func (h *Handler) GetMission(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mission, team, members, plan, assignments, events, ok := h.loadMissionDetail(w, r, id)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, missionDetailToResponse(mission, team, members, plan, assignments, events))
}

func (h *Handler) CreateMission(w http.ResponseWriter, r *http.Request) {
	var req CreateMissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if req.Title == "" {
		req.Title = missionTitleFromPrompt(req.Prompt)
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
	}

	var team db.Team
	if req.TeamID != "" {
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

	if len(req.PlanItems) == 0 {
		req.PlanItems = defaultMissionPlanItems(req.Prompt, req.CaptainAgentID, req.MemberAgentIDs)
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create mission")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	if !team.ID.Valid {
		team, err = qtx.CreateTeam(r.Context(), db.CreateTeamParams{
			WorkspaceID:     wsUUID,
			Name:            "任务小队 · " + req.Title,
			Description:     "由 Origin 任务中枢为本次 Mission 自动创建。",
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
		Title:           req.Title,
		Prompt:          req.Prompt,
		Summary:         req.Summary,
		Outcome:         req.Outcome,
		Status:          "planning",
		RiskLevel:       normalizeRiskLevel(req.RiskLevel),
		ExecutionMode:   normalizeExecutionMode(req.ExecutionMode),
		ChatSessionID:   session.ID,
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
		title := strings.TrimSpace(itemReq.Title)
		if title == "" {
			title = "未命名步骤"
		}
		planItem, err := qtx.CreateMissionPlanItem(r.Context(), db.CreateMissionPlanItemParams{
			MissionID:       mission.ID,
			Title:           title,
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
		Title:       "Mission 已创建",
		Body:        req.Prompt,
		Payload: eventPayload(map[string]any{
			"team_id":          uuidToString(team.ID),
			"captain_agent_id": req.CaptainAgentID,
			"member_agent_ids": req.MemberAgentIDs,
		}),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create mission event")
		return
	}

	msg, err := qtx.CreateTeamChatMessage(r.Context(), db.CreateTeamChatMessageParams{
		ChatSessionID: session.ID,
		Role:          "user",
		Content:       missionBrief(req.Title, req.Prompt, planItems),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to seed mission room")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create mission")
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
		MissionID: mission.ID,
		AgentID:   captain.ID,
		Status:    assignmentStatus,
		RiskLevel: mission.RiskLevel,
		Output:    "",
		PlanItemID: captainPlanItemID,
		TaskID:    taskID,
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
		Body:        "Mission 简报已发送到团队房间，等待负责人拆解和派工。",
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
	resp := missionDetailToResponse(updated, team, members, planItems, assignments, events)
	h.publish(protocol.EventMissionCreated, workspaceID, "member", userID, map[string]any{"mission": resp.Mission})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) UpdateMission(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mission, _, _, _, _, _, ok := h.loadMissionDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req UpdateMissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateMissionParams{ID: mission.ID}
	if req.Title != nil {
		params.Title = pgtype.Text{String: strings.TrimSpace(*req.Title), Valid: true}
	}
	if req.Summary != nil {
		params.Summary = pgtype.Text{String: *req.Summary, Valid: true}
	}
	if req.Outcome != nil {
		params.Outcome = pgtype.Text{String: *req.Outcome, Valid: true}
	}
	if req.Status != nil {
		if !validateMissionStatus(*req.Status) {
			writeError(w, http.StatusBadRequest, "invalid status")
			return
		}
		params.Status = pgtype.Text{String: *req.Status, Valid: true}
	}
	if req.RiskLevel != nil {
		params.RiskLevel = pgtype.Text{String: normalizeRiskLevel(*req.RiskLevel), Valid: true}
	}
	if req.ExecutionMode != nil {
		params.ExecutionMode = pgtype.Text{String: normalizeExecutionMode(*req.ExecutionMode), Valid: true}
	}
	// Re-validating team / captain on update mirrors the CreateMission rules
	// so a PATCH cannot silently link a Mission to another workspace's team
	// or to an agent that does not belong to the chosen team. Without this
	// the FK alone would accept the write — there is no cross-workspace
	// constraint at the DB level.
	var newTeamID, newCaptainID pgtype.UUID
	if req.TeamID != nil && *req.TeamID != "" {
		teamID, ok := parseUUIDOrBadRequest(w, *req.TeamID, "team_id")
		if !ok {
			return
		}
		team, err := h.Queries.GetTeamInWorkspace(r.Context(), db.GetTeamInWorkspaceParams{
			ID:          teamID,
			WorkspaceID: mission.WorkspaceID,
		})
		if err != nil || team.ArchivedAt.Valid {
			writeError(w, http.StatusBadRequest, "team not found in this workspace")
			return
		}
		params.TeamID = teamID
		newTeamID = teamID
	}
	if req.CaptainAgentID != nil && *req.CaptainAgentID != "" {
		captainID, ok := parseUUIDOrBadRequest(w, *req.CaptainAgentID, "captain_agent_id")
		if !ok {
			return
		}
		captain, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID:          captainID,
			WorkspaceID: mission.WorkspaceID,
		})
		if err != nil || captain.ArchivedAt.Valid {
			writeError(w, http.StatusBadRequest, "captain must be an active agent in this workspace")
			return
		}
		params.CaptainAgentID = captainID
		newCaptainID = captainID
	}
	// captain must belong to the (possibly newly chosen) team. CreateMission
	// enforces this; UpdateMission must too or PATCH becomes a backdoor.
	effectiveTeamID := mission.TeamID
	if newTeamID.Valid {
		effectiveTeamID = newTeamID
	}
	effectiveCaptainID := mission.CaptainAgentID
	if newCaptainID.Valid {
		effectiveCaptainID = newCaptainID
	}
	if newTeamID.Valid || newCaptainID.Valid {
		member, err := h.Queries.IsTeamMember(r.Context(), db.IsTeamMemberParams{
			TeamID:  effectiveTeamID,
			AgentID: effectiveCaptainID,
		})
		if err != nil || !member {
			writeError(w, http.StatusBadRequest, "captain must belong to the selected team")
			return
		}
	}

	updated, err := h.Queries.UpdateMission(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update mission")
		return
	}
	resp := missionToResponse(updated)
	h.publish(protocol.EventMissionUpdated, uuidToString(updated.WorkspaceID), "member", userID, map[string]any{"mission": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ArchiveMission(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mission, _, _, _, _, _, ok := h.loadMissionDetail(w, r, id)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	archived, err := h.Queries.ArchiveMission(r.Context(), mission.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive mission")
		return
	}
	resp := missionToResponse(archived)
	h.publish(protocol.EventMissionArchived, uuidToString(archived.WorkspaceID), "member", userID, map[string]any{"mission": resp})
	writeJSON(w, http.StatusOK, resp)
}
