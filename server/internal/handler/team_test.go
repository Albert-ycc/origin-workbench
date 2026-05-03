package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func createTeamTestAgent(t *testing.T, name string) string {
	t.Helper()
	return createHandlerTestAgent(t, name, nil)
}

func createTeamViaHandler(t *testing.T, captainID string, memberIDs []string) TeamResponse {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/teams", map[string]any{
		"name":             "Handler Test Team",
		"description":      "Team handler test",
		"captain_agent_id": captainID,
		"member_agent_ids": memberIDs,
	})
	testHandler.CreateTeam(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateTeam: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var team TeamResponse
	if err := json.NewDecoder(w.Body).Decode(&team); err != nil {
		t.Fatalf("decode team: %v", err)
	}
	t.Cleanup(func() {
		r := newRequest(http.MethodDelete, "/api/teams/"+team.ID, nil)
		r = withURLParam(r, "id", team.ID)
		testHandler.DeleteTeam(httptest.NewRecorder(), r)
	})
	return team
}

func TestCreateTeamCreatesCaptainAndMembers(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Team Captain")
	memberID := createTeamTestAgent(t, "Team Member")

	team := createTeamViaHandler(t, captainID, []string{memberID})

	if team.CaptainAgentID != captainID {
		t.Fatalf("captain id = %s, want %s", team.CaptainAgentID, captainID)
	}
	if len(team.Members) != 2 {
		t.Fatalf("expected 2 members, got %d: %+v", len(team.Members), team.Members)
	}
	if team.Members[0].AgentID != captainID || team.Members[0].Role != "captain" {
		t.Fatalf("first member should be captain row, got %+v", team.Members[0])
	}
}

func TestUpdateTeamCaptainSwapAllowsRemovingPreviousCaptain(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	oldCaptainID := createTeamTestAgent(t, "Old Captain")
	newCaptainID := createTeamTestAgent(t, "New Captain")
	team := createTeamViaHandler(t, oldCaptainID, []string{newCaptainID})

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPatch, "/api/teams/"+team.ID, map[string]any{
		"captain_agent_id": newCaptainID,
	})
	req = withURLParam(req, "id", team.ID)
	testHandler.UpdateTeam(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateTeam captain: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodDelete, "/api/teams/"+team.ID+"/members/"+oldCaptainID, nil)
	req = withURLParams(req, "id", team.ID, "memberId", oldCaptainID)
	testHandler.RemoveTeamMember(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Remove old captain: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var updated TeamResponse
	if err := json.NewDecoder(w.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated: %v", err)
	}
	for _, m := range updated.Members {
		if m.AgentID == oldCaptainID {
			t.Fatalf("old captain should have been removable after swap, members: %+v", updated.Members)
		}
	}
}

func TestTeamArchiveRestoreAndListFiltering(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Archive Captain")
	team := createTeamViaHandler(t, captainID, nil)

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/teams/"+team.ID+"/archive", nil)
	req = withURLParam(req, "id", team.ID)
	testHandler.ArchiveTeam(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ArchiveTeam: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var archived TeamResponse
	if err := json.NewDecoder(w.Body).Decode(&archived); err != nil {
		t.Fatalf("decode archived: %v", err)
	}
	if archived.ArchivedAt == nil {
		t.Fatal("expected archived_at to be set")
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/teams", nil)
	testHandler.ListTeams(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListTeams active: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var active struct {
		Teams []TeamResponse `json:"teams"`
	}
	if err := json.NewDecoder(w.Body).Decode(&active); err != nil {
		t.Fatalf("decode active list: %v", err)
	}
	for _, row := range active.Teams {
		if row.ID == team.ID {
			t.Fatal("archived team should not appear in active list")
		}
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/teams?status=archived", nil)
	testHandler.ListTeams(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListTeams archived: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var archivedList struct {
		Teams []TeamResponse `json:"teams"`
	}
	if err := json.NewDecoder(w.Body).Decode(&archivedList); err != nil {
		t.Fatalf("decode archived list: %v", err)
	}
	foundArchived := false
	for _, row := range archivedList.Teams {
		if row.ID == team.ID {
			foundArchived = true
		}
	}
	if !foundArchived {
		t.Fatal("archived team should appear in archived list")
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/teams/"+team.ID+"/restore", nil)
	req = withURLParam(req, "id", team.ID)
	testHandler.RestoreTeam(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("RestoreTeam: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var restored TeamResponse
	if err := json.NewDecoder(w.Body).Decode(&restored); err != nil {
		t.Fatalf("decode restored: %v", err)
	}
	if restored.ArchivedAt != nil {
		t.Fatal("expected archived_at to be cleared")
	}
}

func TestListTeamMessagesPaginatesOlderMessages(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Paging Captain")
	team := createTeamViaHandler(t, captainID, nil)

	session, err := testHandler.Queries.GetOrCreateTeamChatSession(
		newRequest(http.MethodGet, "/", nil).Context(),
		db.GetOrCreateTeamChatSessionParams{
			TeamID:      parseUUID(team.ID),
			WorkspaceID: parseUUID(testWorkspaceID),
			CreatorID:   parseUUID(testUserID),
			Title:       team.Name,
		},
	)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	for _, content := range []string{"one", "two", "three"} {
		if _, err := testHandler.Queries.CreateTeamChatMessage(
			newRequest(http.MethodGet, "/", nil).Context(),
			db.CreateTeamChatMessageParams{
				ChatSessionID: session.ID,
				Role:          "user",
				Content:       content,
			},
		); err != nil {
			t.Fatalf("insert message %q: %v", content, err)
		}
	}

	w := httptest.NewRecorder()
	req := newRequest(http.MethodGet, "/api/teams/"+team.ID+"/messages?limit=2", nil)
	req = withURLParam(req, "id", team.ID)
	testHandler.ListTeamMessages(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListTeamMessages page 1: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var page1 ListTeamMessagesResponse
	if err := json.NewDecoder(w.Body).Decode(&page1); err != nil {
		t.Fatalf("decode page1: %v", err)
	}
	if len(page1.Messages) != 2 {
		t.Fatalf("page1 messages = %d, want 2", len(page1.Messages))
	}
	if page1.Messages[0].Content != "two" || page1.Messages[1].Content != "three" {
		t.Fatalf("page1 should return oldest->newest within latest page, got %+v", page1.Messages)
	}
	if page1.NextCursor == nil || *page1.NextCursor == "" {
		t.Fatalf("expected next cursor for older page, got %+v", page1.NextCursor)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/teams/"+team.ID+"/messages?limit=2&before="+*page1.NextCursor, nil)
	req = withURLParam(req, "id", team.ID)
	testHandler.ListTeamMessages(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListTeamMessages page 2: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var page2 ListTeamMessagesResponse
	if err := json.NewDecoder(w.Body).Decode(&page2); err != nil {
		t.Fatalf("decode page2: %v", err)
	}
	if len(page2.Messages) != 1 || page2.Messages[0].Content != "one" {
		t.Fatalf("page2 mismatch: %+v", page2.Messages)
	}
	if page2.NextCursor != nil {
		t.Fatalf("expected no next cursor, got %q", *page2.NextCursor)
	}
}

func TestCompleteTeamCaptainMessageDelegatesMentionedMember(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Delegating Captain")
	memberID := createTeamTestAgent(t, "Frontend Delegate")
	team := createTeamViaHandler(t, captainID, []string{memberID})

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/teams/"+team.ID+"/messages", map[string]any{
		"content": "请负责人拆一下：@Frontend Delegate 做页面验证",
	})
	req = withURLParam(req, "id", team.ID)
	testHandler.PostTeamMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("PostTeamMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var captainTaskID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id FROM agent_task_queue
		WHERE agent_id = $1 AND chat_session_id IS NOT NULL
		ORDER BY created_at DESC LIMIT 1
	`, captainID).Scan(&captainTaskID); err != nil {
		t.Fatalf("load captain task: %v", err)
	}
	claimed, err := testHandler.TaskService.ClaimTask(context.Background(), parseUUID(captainID))
	if err != nil {
		t.Fatalf("claim captain task: %v", err)
	}
	if claimed == nil || uuidToString(claimed.ID) != captainTaskID {
		t.Fatalf("claimed captain task mismatch: got %+v want %s", claimed, captainTaskID)
	}
	if _, err := testHandler.TaskService.StartTask(context.Background(), claimed.ID); err != nil {
		t.Fatalf("start captain task: %v", err)
	}
	result, _ := json.Marshal(protocol.TaskCompletedPayload{
		TaskID: captainTaskID,
		Output: "@Frontend Delegate 请你负责实现前端交互验证，并把结论回到群里。",
	})
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(captainTaskID), result, "session-delegate", ""); err != nil {
		t.Fatalf("complete captain task: %v", err)
	}

	var memberTaskCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM agent_task_queue
		WHERE agent_id = $1 AND chat_session_id IS NOT NULL AND status = 'queued'
	`, memberID).Scan(&memberTaskCount); err != nil {
		t.Fatalf("count member tasks: %v", err)
	}
	if memberTaskCount != 1 {
		t.Fatalf("expected one queued delegated member task, got %d", memberTaskCount)
	}

	var systemMessage string
	if err := testPool.QueryRow(context.Background(), `
		SELECT content FROM chat_message
		WHERE chat_session_id = (
			SELECT chat_session_id FROM agent_task_queue WHERE id = $1
		)
		  AND role = 'assistant'
		  AND sender_agent_id IS NULL
		ORDER BY created_at DESC LIMIT 1
	`, captainTaskID).Scan(&systemMessage); err != nil {
		t.Fatalf("load delegation system message: %v", err)
	}
	if systemMessage == "" || systemMessage == "负责人已分派任务。" {
		t.Fatalf("expected detailed delegation system message, got %q", systemMessage)
	}

	var delegatedContext []byte
	if err := testPool.QueryRow(context.Background(), `
		SELECT context FROM agent_task_queue
		WHERE agent_id = $1 AND chat_session_id IS NOT NULL AND status = 'queued'
		ORDER BY created_at DESC LIMIT 1
	`, memberID).Scan(&delegatedContext); err != nil {
		t.Fatalf("load delegated task context: %v", err)
	}
	var delegation struct {
		Type            string `json:"type"`
		SourceAgentName string `json:"source_agent_name"`
		TargetAgentName string `json:"target_agent_name"`
		Instruction     string `json:"instruction"`
	}
	if err := json.Unmarshal(delegatedContext, &delegation); err != nil {
		t.Fatalf("decode delegated context: %v", err)
	}
	if delegation.Type != "team_delegation" || delegation.TargetAgentName != "Frontend Delegate" || delegation.Instruction == "" {
		t.Fatalf("unexpected delegated context: %+v", delegation)
	}
}

func TestMissionCaptainDelegationCreatesMissionAssignmentAndEvent(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Mission Captain")
	memberID := createTeamTestAgent(t, "Mission Builder")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/missions", map[string]any{
		"title":            "验证 Mission 派工闭环",
		"prompt":           "请把任务拆给成员执行，并在群聊记录过程。",
		"captain_agent_id": captainID,
		"member_agent_ids": []string{memberID},
		"plan_items": []map[string]any{
			{
				"title":             "负责人拆解计划",
				"description":       "明确目标和分工",
				"phase":             "plan",
				"assigned_agent_id": captainID,
			},
		},
	})
	testHandler.CreateMission(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMission: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var missionResp MissionDetailResponse
	if err := json.NewDecoder(w.Body).Decode(&missionResp); err != nil {
		t.Fatalf("decode mission: %v", err)
	}

	var captainTaskID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id FROM agent_task_queue
		WHERE agent_id = $1 AND chat_session_id = $2
		ORDER BY created_at DESC LIMIT 1
	`, captainID, missionResp.Mission.ChatSessionID).Scan(&captainTaskID); err != nil {
		t.Fatalf("load captain mission task: %v", err)
	}
	claimed, err := testHandler.TaskService.ClaimTask(context.Background(), parseUUID(captainID))
	if err != nil {
		t.Fatalf("claim captain task: %v", err)
	}
	if claimed == nil || uuidToString(claimed.ID) != captainTaskID {
		t.Fatalf("claimed captain task mismatch: got %+v want %s", claimed, captainTaskID)
	}
	if _, err := testHandler.TaskService.StartTask(context.Background(), claimed.ID); err != nil {
		t.Fatalf("start captain task: %v", err)
	}
	result, _ := json.Marshal(protocol.TaskCompletedPayload{
		TaskID: captainTaskID,
		Output: "@Mission Builder 请你完成第一轮实现，并把风险和结论回到这个 Mission 群聊。",
	})
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(captainTaskID), result, "session-mission-delegate", ""); err != nil {
		t.Fatalf("complete captain task: %v", err)
	}

	var memberTaskID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id FROM agent_task_queue
		WHERE agent_id = $1 AND chat_session_id = $2 AND status = 'queued'
		ORDER BY created_at DESC LIMIT 1
	`, memberID, missionResp.Mission.ChatSessionID).Scan(&memberTaskID); err != nil {
		t.Fatalf("load member task: %v", err)
	}

	var planCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM mission_plan_item
		WHERE mission_id = $1
		  AND assigned_agent_id = $2
		  AND status = 'in_progress'
		  AND phase = 'execute'
	`, missionResp.Mission.ID, memberID).Scan(&planCount); err != nil {
		t.Fatalf("count delegated plan items: %v", err)
	}
	if planCount != 1 {
		t.Fatalf("expected one in-progress delegated mission plan item, got %d", planCount)
	}

	var assignmentCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM mission_assignment
		WHERE mission_id = $1
		  AND agent_id = $2
		  AND task_id = $3
		  AND status = 'dispatched'
	`, missionResp.Mission.ID, memberID, memberTaskID).Scan(&assignmentCount); err != nil {
		t.Fatalf("count delegated assignments: %v", err)
	}
	if assignmentCount != 1 {
		t.Fatalf("expected one dispatched mission assignment, got %d", assignmentCount)
	}

	var eventCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM mission_event
		WHERE mission_id = $1
		  AND actor_type = 'agent'
		  AND actor_id = $2
		  AND kind = 'member_delegated'
	`, missionResp.Mission.ID, captainID).Scan(&eventCount); err != nil {
		t.Fatalf("count mission delegation events: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("expected one member_delegated mission event, got %d", eventCount)
	}
}

func TestMissionMemberCompletionCreatesTimelineAndMemoryCandidate(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Mission Timeline Captain")
	memberID := createTeamTestAgent(t, "Mission Timeline Builder")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/missions", map[string]any{
		"title":            "验证 Mission 结果沉淀",
		"prompt":           "请拆给成员执行，并沉淀完成记录。",
		"captain_agent_id": captainID,
		"member_agent_ids": []string{memberID},
		"plan_items": []map[string]any{
			{
				"title":             "负责人派工",
				"phase":             "plan",
				"assigned_agent_id": captainID,
			},
		},
	})
	testHandler.CreateMission(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMission: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var missionResp MissionDetailResponse
	if err := json.NewDecoder(w.Body).Decode(&missionResp); err != nil {
		t.Fatalf("decode mission: %v", err)
	}

	var captainTaskID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id FROM agent_task_queue
		WHERE agent_id = $1 AND chat_session_id = $2
		ORDER BY created_at DESC LIMIT 1
	`, captainID, missionResp.Mission.ChatSessionID).Scan(&captainTaskID); err != nil {
		t.Fatalf("load captain task: %v", err)
	}
	claimedCaptain, err := testHandler.TaskService.ClaimTask(context.Background(), parseUUID(captainID))
	if err != nil {
		t.Fatalf("claim captain task: %v", err)
	}
	if _, err := testHandler.TaskService.StartTask(context.Background(), claimedCaptain.ID); err != nil {
		t.Fatalf("start captain task: %v", err)
	}
	captainResult, _ := json.Marshal(protocol.TaskCompletedPayload{
		TaskID: captainTaskID,
		Output: "@Mission Timeline Builder 请你完成执行，并输出复盘要点。",
	})
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(captainTaskID), captainResult, "session-mission-timeline-captain", ""); err != nil {
		t.Fatalf("complete captain task: %v", err)
	}

	var memberTaskID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id FROM agent_task_queue
		WHERE agent_id = $1 AND chat_session_id = $2 AND status = 'queued'
		ORDER BY created_at DESC LIMIT 1
	`, memberID, missionResp.Mission.ChatSessionID).Scan(&memberTaskID); err != nil {
		t.Fatalf("load member task: %v", err)
	}
	claimedMember, err := testHandler.TaskService.ClaimTask(context.Background(), parseUUID(memberID))
	if err != nil {
		t.Fatalf("claim member task: %v", err)
	}
	if claimedMember == nil || uuidToString(claimedMember.ID) != memberTaskID {
		t.Fatalf("claimed member task mismatch: got %+v want %s", claimedMember, memberTaskID)
	}
	if _, err := testHandler.TaskService.StartTask(context.Background(), claimedMember.ID); err != nil {
		t.Fatalf("start member task: %v", err)
	}
	memberResult, _ := json.Marshal(protocol.TaskCompletedPayload{
		TaskID: memberTaskID,
		Output: "完成：已实现核心流程。复盘：后续需要把高风险动作加入确认队列。",
	})
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(memberTaskID), memberResult, "session-mission-timeline-member", ""); err != nil {
		t.Fatalf("complete member task: %v", err)
	}

	var assignmentStatus string
	if err := testPool.QueryRow(context.Background(), `
		SELECT status FROM mission_assignment
		WHERE task_id = $1
	`, memberTaskID).Scan(&assignmentStatus); err != nil {
		t.Fatalf("load member assignment: %v", err)
	}
	if assignmentStatus != "completed" {
		t.Fatalf("assignment status = %q, want completed", assignmentStatus)
	}

	var eventCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM mission_event
		WHERE mission_id = $1
		  AND actor_type = 'agent'
		  AND actor_id = $2
		  AND kind = 'assignment_completed'
	`, missionResp.Mission.ID, memberID).Scan(&eventCount); err != nil {
		t.Fatalf("count mission completion events: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("expected one mission completion event, got %d", eventCount)
	}

	events, err := testHandler.Queries.ListAgentEvents(context.Background(), db.ListAgentEventsParams{
		WorkspaceID: parseUUID(testWorkspaceID),
		AgentID:     parseUUID(memberID),
		Limit:       20,
	})
	if err != nil {
		t.Fatalf("list agent events: %v", err)
	}
	foundTimeline := false
	for _, event := range events {
		if event.Kind == "mission_assignment_completed" {
			foundTimeline = true
			break
		}
	}
	if !foundTimeline {
		t.Fatalf("expected mission_assignment_completed agent event, got %+v", events)
	}

	memories, err := testHandler.Queries.ListAgentMemories(context.Background(), db.ListAgentMemoriesParams{
		WorkspaceID: parseUUID(testWorkspaceID),
		AgentID:     parseUUID(memberID),
		Limit:       20,
		Statuses:    []string{"candidate", "confirmed"},
	})
	if err != nil {
		t.Fatalf("list agent memories: %v", err)
	}
	foundMemory := false
	for _, memory := range memories {
		if memory.Kind == "mission_reflection" && memory.RefType == "mission_assignment" {
			if memory.Status != "candidate" {
				t.Fatalf("mission reflection should remain a candidate until confirmed, got %q", memory.Status)
			}
			foundMemory = true
			break
		}
	}
	if !foundMemory {
		t.Fatalf("expected mission_reflection memory candidate, got %+v", memories)
	}
}

func TestCompleteTeamMessageAutoCreatesMemories(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Memory Captain")
	team := createTeamViaHandler(t, captainID, nil)

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/teams/"+team.ID+"/messages", map[string]any{
		"content": "请记录这次方案",
	})
	req = withURLParam(req, "id", team.ID)
	testHandler.PostTeamMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("PostTeamMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var captainTaskID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id FROM agent_task_queue
		WHERE agent_id = $1 AND chat_session_id IS NOT NULL
		ORDER BY created_at DESC LIMIT 1
	`, captainID).Scan(&captainTaskID); err != nil {
		t.Fatalf("load captain task: %v", err)
	}
	claimed, err := testHandler.TaskService.ClaimTask(context.Background(), parseUUID(captainID))
	if err != nil {
		t.Fatalf("claim captain task: %v", err)
	}
	if claimed == nil || uuidToString(claimed.ID) != captainTaskID {
		t.Fatalf("claimed captain task mismatch: got %+v want %s", claimed, captainTaskID)
	}
	if _, err := testHandler.TaskService.StartTask(context.Background(), claimed.ID); err != nil {
		t.Fatalf("start captain task: %v", err)
	}
	result, _ := json.Marshal(protocol.TaskCompletedPayload{
		TaskID: captainTaskID,
		Output: "决策：团队负责人先拆解需求，再由各专业智能体分别执行。\n问题：如果成员没有响应，需要在群聊里暴露失败原因。",
	})
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(captainTaskID), result, "session-memory", ""); err != nil {
		t.Fatalf("complete captain task: %v", err)
	}

	rows, err := testHandler.Queries.ListAgentMemories(context.Background(), db.ListAgentMemoriesParams{
		WorkspaceID: parseUUID(testWorkspaceID),
		AgentID:     parseUUID(captainID),
		Limit:       10,
		Statuses:    []string{"candidate", "confirmed"},
	})
	if err != nil {
		t.Fatalf("list memories: %v", err)
	}
	foundDecision := false
	foundProblem := false
	for _, row := range rows {
		if row.Kind == "decision" {
			foundDecision = true
		}
		if row.Kind == "problem" {
			foundProblem = true
		}
		if row.RefType != "team_message" || !row.RefID.Valid {
			t.Fatalf("memory should reference the team assistant message, got ref_type=%q ref_id=%v", row.RefType, row.RefID)
		}
		if row.Status != "candidate" {
			t.Fatalf("auto-created team memory should remain a candidate until confirmed, got %q", row.Status)
		}
	}
	if !foundDecision || !foundProblem {
		t.Fatalf("expected decision and problem memories, got %+v", rows)
	}

	events, err := testHandler.Queries.ListAgentEvents(context.Background(), db.ListAgentEventsParams{
		WorkspaceID: parseUUID(testWorkspaceID),
		AgentID:     parseUUID(captainID),
		Limit:       10,
	})
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	foundEvent := false
	for _, event := range events {
		if event.Kind == "memory_candidate_created" {
			foundEvent = true
			break
		}
	}
	if !foundEvent {
		t.Fatalf("expected memory_created event, got %+v", events)
	}
}

func TestCompleteTeamMessageAutoCreatesSkillCandidateAndConfirm(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Skill Candidate Captain")
	team := createTeamViaHandler(t, captainID, nil)

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/teams/"+team.ID+"/messages", map[string]any{
		"content": "请把这次协作沉淀成可复用能力",
	})
	req = withURLParam(req, "id", team.ID)
	testHandler.PostTeamMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("PostTeamMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var captainTaskID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id FROM agent_task_queue
		WHERE agent_id = $1 AND chat_session_id IS NOT NULL
		ORDER BY created_at DESC LIMIT 1
	`, captainID).Scan(&captainTaskID); err != nil {
		t.Fatalf("load captain task: %v", err)
	}
	claimed, err := testHandler.TaskService.ClaimTask(context.Background(), parseUUID(captainID))
	if err != nil {
		t.Fatalf("claim captain task: %v", err)
	}
	if claimed == nil || uuidToString(claimed.ID) != captainTaskID {
		t.Fatalf("claimed captain task mismatch: got %+v want %s", claimed, captainTaskID)
	}
	if _, err := testHandler.TaskService.StartTask(context.Background(), claimed.ID); err != nil {
		t.Fatalf("start captain task: %v", err)
	}
	result, _ := json.Marshal(protocol.TaskCompletedPayload{
		TaskID: captainTaskID,
		Output: "技能：复盘沉淀闭环测试 - 把团队协作复盘转成可执行模板",
	})
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(captainTaskID), result, "session-skill-candidate", ""); err != nil {
		t.Fatalf("complete captain task: %v", err)
	}

	candidates, err := testHandler.Queries.ListAgentSkillCandidates(context.Background(), db.ListAgentSkillCandidatesParams{
		WorkspaceID: parseUUID(testWorkspaceID),
		AgentID:     parseUUID(captainID),
		Limit:       10,
		Statuses:    []string{"candidate", "confirmed"},
	})
	if err != nil {
		t.Fatalf("list skill candidates: %v", err)
	}
	var candidate db.AgentSkillCandidate
	foundCandidate := false
	for _, row := range candidates {
		if row.Name == "复盘沉淀闭环测试" {
			candidate = row
			foundCandidate = true
			break
		}
	}
	if !foundCandidate {
		t.Fatalf("expected skill candidate, got %+v", candidates)
	}
	if candidate.Status != "candidate" || candidate.RefType != "team_message" || !candidate.RefID.Valid {
		t.Fatalf("unexpected candidate state: %+v", candidate)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/agents/"+captainID+"/skill-candidates/"+uuidToString(candidate.ID)+"/confirm", nil)
	req = withURLParams(req, "id", captainID, "candidateId", uuidToString(candidate.ID))
	testHandler.ConfirmAgentSkillCandidate(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ConfirmAgentSkillCandidate: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var confirmed AgentSkillCandidateResponse
	if err := json.NewDecoder(w.Body).Decode(&confirmed); err != nil {
		t.Fatalf("decode confirmed candidate: %v", err)
	}
	if confirmed.Status != "confirmed" || confirmed.SkillID == nil || *confirmed.SkillID == "" {
		t.Fatalf("unexpected confirmed candidate: %+v", confirmed)
	}

	skills, err := testHandler.Queries.ListAgentSkills(context.Background(), parseUUID(captainID))
	if err != nil {
		t.Fatalf("list agent skills: %v", err)
	}
	foundSkill := false
	for _, skill := range skills {
		if skill.Name == "复盘沉淀闭环测试" {
			foundSkill = true
			if confirmed.SkillID == nil || uuidToString(skill.ID) != *confirmed.SkillID {
				t.Fatalf("confirmed skill id mismatch: skill=%s confirmed=%v", uuidToString(skill.ID), confirmed.SkillID)
			}
			break
		}
	}
	if !foundSkill {
		t.Fatalf("expected confirmed skill to be attached to agent, got %+v", skills)
	}

	var eventCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM agent_event
		WHERE agent_id = $1
		  AND kind IN ('skill_candidate_created', 'skill_attached', 'skill_candidate_confirmed')
	`, captainID).Scan(&eventCount); err != nil {
		t.Fatalf("count skill candidate events: %v", err)
	}
	if eventCount < 2 {
		t.Fatalf("expected skill candidate timeline events, got %d", eventCount)
	}
}
