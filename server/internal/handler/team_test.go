package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/events"
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

func createTeamTestProject(t *testing.T, title string) ProjectResponse {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title":    title,
		"status":   "active",
		"priority": "medium",
	})
	testHandler.CreateProject(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateProject: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var project ProjectResponse
	if err := json.NewDecoder(w.Body).Decode(&project); err != nil {
		t.Fatalf("decode project: %v", err)
	}
	t.Cleanup(func() {
		req := newRequest(http.MethodDelete, "/api/projects/"+project.ID, nil)
		req = withURLParam(req, "id", project.ID)
		testHandler.DeleteProject(httptest.NewRecorder(), req)
	})
	return project
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

func completeCaptainDelegationForTest(t *testing.T, teamID string, captainID string, output string) string {
	t.Helper()
	_ = teamID
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
		Output: output,
	})
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(captainTaskID), result, "session-delegate", ""); err != nil {
		t.Fatalf("complete captain task: %v", err)
	}
	return captainTaskID
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

	captainTaskID := completeCaptainDelegationForTest(
		t,
		team.ID,
		captainID,
		"@Frontend Delegate 请你负责实现前端交互验证，并把结论回到群里。",
	)

	// D 方案 (commit c996f62f): captain @ 派活落地为 issue 卡片，不再起独立
	// chat task。member 拿到的是 issue assignment 自动 enqueue 的 task（带
	// issue_id，无 chat_session_id），所以验证从 agent_task_queue 移到 issue。
	var memberIssueID string
	var issueDescription string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id::text, COALESCE(description, '') FROM issue
		WHERE assignee_id = $1 AND source_team_message_id IS NOT NULL
		ORDER BY created_at DESC LIMIT 1
	`, memberID).Scan(&memberIssueID, &issueDescription); err != nil {
		t.Fatalf("load member delegated issue: %v", err)
	}
	if !strings.Contains(issueDescription, "前端交互") {
		t.Fatalf("issue description should carry captain's instruction text, got %q", issueDescription)
	}

	var memberIssueCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM issue
		WHERE assignee_id = $1 AND source_team_message_id IS NOT NULL
	`, memberID).Scan(&memberIssueCount); err != nil {
		t.Fatalf("count member issues: %v", err)
	}
	if memberIssueCount != 1 {
		t.Fatalf("expected exactly one delegated issue for member, got %d", memberIssueCount)
	}

	// captain 派活后写一条 system message 通报群聊（D 方案文案：「负责人 X
	// 已派任务给 Y（共 N 张任务卡片）。」），同时点出 captain 名和被 @ 的成员名。
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
	if !strings.Contains(systemMessage, "Delegating Captain") || !strings.Contains(systemMessage, "Frontend Delegate") {
		t.Fatalf("expected system message to name captain and delegate, got %q", systemMessage)
	}

	// 新创建的 issue 应该已经被 EnqueueTaskForIssue 自动排上一条 member task。
	var memberTaskCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM agent_task_queue
		WHERE agent_id = $1 AND issue_id::text = $2 AND status = 'queued'
	`, memberID, memberIssueID).Scan(&memberTaskCount); err != nil {
		t.Fatalf("count member task for issue: %v", err)
	}
	if memberTaskCount != 1 {
		t.Fatalf("expected one queued task for delegated issue, got %d", memberTaskCount)
	}
}

func TestTeamDelegatedIssueCopiesProjectIDFromSession(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Project Captain")
	memberID := createTeamTestAgent(t, "Project Reviewer")
	team := createTeamViaHandler(t, captainID, []string{memberID})
	project := createTeamTestProject(t, "Project scoped delegation")

	session, err := testHandler.Queries.GetOrCreateTeamChatSession(
		newRequest(http.MethodGet, "/", nil).Context(),
		db.GetOrCreateTeamChatSessionParams{
			TeamID:      parseUUID(team.ID),
			WorkspaceID: parseUUID(testWorkspaceID),
			CreatorID:   parseUUID(testUserID),
			Title:       team.Name,
			ProjectID:   parseUUID(project.ID),
		},
	)
	if err != nil {
		t.Fatalf("create project team session: %v", err)
	}
	if _, err := testHandler.Queries.CreateTeamChatMessage(
		context.Background(),
		db.CreateTeamChatMessageParams{
			ChatSessionID: session.ID,
			Role:          "user",
			Content:       "@Project Captain 请拆给项目成员评审",
		},
	); err != nil {
		t.Fatalf("create user team message: %v", err)
	}
	task, err := testHandler.TaskService.EnqueueChatTaskForAgent(context.Background(), session, parseUUID(captainID))
	if err != nil {
		t.Fatalf("enqueue captain task: %v", err)
	}
	claimed, err := testHandler.TaskService.ClaimTask(context.Background(), parseUUID(captainID))
	if err != nil {
		t.Fatalf("claim captain task: %v", err)
	}
	if claimed == nil || uuidToString(claimed.ID) != uuidToString(task.ID) {
		t.Fatalf("claimed captain task mismatch: got %+v want %s", claimed, uuidToString(task.ID))
	}
	if _, err := testHandler.TaskService.StartTask(context.Background(), claimed.ID); err != nil {
		t.Fatalf("start captain task: %v", err)
	}
	payload, _ := json.Marshal(protocol.TaskCompletedPayload{
		TaskID: uuidToString(task.ID),
		Output: "@Project Reviewer 请从项目视角评审这份需求。",
	})
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), task.ID, payload, "session-project-delegate", ""); err != nil {
		t.Fatalf("complete captain task: %v", err)
	}

	var issueProjectID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT project_id::text FROM issue
		WHERE assignee_id = $1 AND source_team_message_id IS NOT NULL
		ORDER BY created_at DESC LIMIT 1
	`, memberID).Scan(&issueProjectID); err != nil {
		t.Fatalf("load delegated issue project id: %v", err)
	}
	if issueProjectID != project.ID {
		t.Fatalf("delegated issue project_id = %q, want %q", issueProjectID, project.ID)
	}
}

func TestTeamDelegatedIssueCompletionDoesNotCreateMainChatMessage(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "No Mirror Captain")
	memberID := createTeamTestAgent(t, "No Mirror Reviewer")
	team := createTeamViaHandler(t, captainID, []string{memberID})

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/teams/"+team.ID+"/messages", map[string]any{
		"content": "@No Mirror Captain 请分派评审任务",
	})
	req = withURLParam(req, "id", team.ID)
	testHandler.PostTeamMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("PostTeamMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	captainTaskID := completeCaptainDelegationForTest(
		t,
		team.ID,
		captainID,
		"@No Mirror Reviewer 请评审需求并在任务卡里回报。",
	)

	var issueID string
	var sessionID string
	var sourceMessageID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT i.id::text, i.source_team_session_id::text, i.source_team_message_id::text
		FROM issue i
		WHERE i.assignee_id = $1 AND i.source_team_message_id IS NOT NULL
		ORDER BY i.created_at DESC LIMIT 1
	`, memberID).Scan(&issueID, &sessionID, &sourceMessageID); err != nil {
		t.Fatalf("load delegated issue: %v", err)
	}

	if _, err := testHandler.Queries.CreateComment(context.Background(), db.CreateCommentParams{
		IssueID:     parseUUID(issueID),
		WorkspaceID: parseUUID(testWorkspaceID),
		AuthorType:  "agent",
		AuthorID:    parseUUID(memberID),
		Content:     "这是很长的成员评审正文，应该留在任务卡详情里。",
		Type:        "comment",
	}); err != nil {
		t.Fatalf("create member result comment: %v", err)
	}

	issue, err := testHandler.Queries.UpdateIssueStatus(context.Background(), db.UpdateIssueStatusParams{
		ID:     parseUUID(issueID),
		Status: "in_review",
	})
	if err != nil {
		t.Fatalf("update issue status: %v", err)
	}

	gotEvent := make(chan events.Event, 1)
	testHandler.Bus.Subscribe(protocol.EventTeamMessageCreated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok || payload["event"] != "team_task_completed" {
			return
		}
		select {
		case gotEvent <- e:
		default:
		}
	})
	testHandler.TaskService.MirrorIssueCompletionToTeamSession(context.Background(), issue)

	var event events.Event
	select {
	case event = <-gotEvent:
	default:
		t.Fatal("expected team_task_completed event")
	}
	if event.Type != protocol.EventTeamMessageCreated {
		t.Fatalf("event type = %q, want %q", event.Type, protocol.EventTeamMessageCreated)
	}
	if event.ActorType != "agent" {
		t.Fatalf("event actor type = %q, want agent", event.ActorType)
	}
	if event.ActorID != memberID {
		t.Fatalf("event actor id = %q, want %q", event.ActorID, memberID)
	}
	eventPayload, ok := event.Payload.(map[string]any)
	if !ok {
		t.Fatalf("event payload type = %T, want map[string]any", event.Payload)
	}
	if eventPayload["event"] != "team_task_completed" {
		t.Fatalf("event payload event = %q, want team_task_completed", eventPayload["event"])
	}
	if eventPayload["issue_id"] != issueID {
		t.Fatalf("event payload issue_id = %q, want %q", eventPayload["issue_id"], issueID)
	}
	if eventPayload["source_team_session_id"] != sessionID {
		t.Fatalf("event payload source_team_session_id = %q, want %q", eventPayload["source_team_session_id"], sessionID)
	}
	if eventPayload["chat_session_id"] != sessionID {
		t.Fatalf("event payload chat_session_id = %q, want %q", eventPayload["chat_session_id"], sessionID)
	}
	if eventPayload["team_id"] != team.ID {
		t.Fatalf("event payload team_id = %q, want %q", eventPayload["team_id"], team.ID)
	}
	if sourceMessageID == "" {
		t.Fatal("expected delegated issue source_team_message_id to be non-empty")
	}
	if eventPayload["source_team_message_id"] != sourceMessageID {
		t.Fatalf("event payload source_team_message_id = %q, want %q", eventPayload["source_team_message_id"], sourceMessageID)
	}

	var mirroredCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM chat_message
		WHERE chat_session_id = $1
		  AND sender_agent_id = $2
		  AND content LIKE '%这是很长的成员评审正文%'
	`, sessionID, memberID).Scan(&mirroredCount); err != nil {
		t.Fatalf("count mirrored messages: %v", err)
	}
	if mirroredCount != 0 {
		t.Fatalf("expected no mirrored completion chat message, got %d", mirroredCount)
	}

	var captainSessionID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT chat_session_id::text FROM agent_task_queue WHERE id = $1
	`, captainTaskID).Scan(&captainSessionID); err != nil {
		t.Fatalf("load captain session id: %v", err)
	}
	if captainSessionID != sessionID {
		t.Fatalf("completion session = %s, want captain session %s", sessionID, captainSessionID)
	}
}

func TestListDelegationTaskCardsByTeamMessageIncludesLatestResultPreview(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Card Captain")
	memberID := createTeamTestAgent(t, "Card Reviewer")
	team := createTeamViaHandler(t, captainID, []string{memberID})

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/teams/"+team.ID+"/messages", map[string]any{
		"content": "@Card Captain 请拆一张卡片任务",
	})
	req = withURLParam(req, "id", team.ID)
	testHandler.PostTeamMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("PostTeamMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	completeCaptainDelegationForTest(
		t,
		team.ID,
		captainID,
		"@Card Reviewer 请评审，并把长结论写进任务卡。",
	)

	var issueID string
	var sourceMessageID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id::text, source_team_message_id::text
		FROM issue
		WHERE assignee_id = $1 AND source_team_message_id IS NOT NULL
		ORDER BY created_at DESC LIMIT 1
	`, memberID).Scan(&issueID, &sourceMessageID); err != nil {
		t.Fatalf("load delegated issue: %v", err)
	}
	if _, err := testHandler.Queries.CreateComment(context.Background(), db.CreateCommentParams{
		IssueID:     parseUUID(issueID),
		WorkspaceID: parseUUID(testWorkspaceID),
		AuthorType:  "agent",
		AuthorID:    parseUUID(memberID),
		Content:     "第一段结论：这个任务卡详情应该展示完整正文，列表只展示摘要。",
		Type:        "comment",
	}); err != nil {
		t.Fatalf("create comment: %v", err)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/issues/by-team-message/"+sourceMessageID+"/cards", nil)
	req = withURLParam(req, "messageId", sourceMessageID)
	testHandler.ListDelegationTaskCardsByTeamMessage(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListDelegationTaskCardsByTeamMessage: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Cards []DelegationTaskCardResponse `json:"cards"`
		Total int                          `json:"total"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode cards: %v", err)
	}
	if resp.Total != 1 || len(resp.Cards) != 1 {
		t.Fatalf("expected one card, got total=%d cards=%+v", resp.Total, resp.Cards)
	}
	card := resp.Cards[0]
	if card.AssigneeName == nil || *card.AssigneeName != "Card Reviewer" {
		t.Fatalf("assignee name mismatch: %+v", card.AssigneeName)
	}
	if card.LatestResultPreview == nil || !strings.Contains(*card.LatestResultPreview, "第一段结论") {
		t.Fatalf("latest result preview mismatch: %+v", card.LatestResultPreview)
	}
	if card.CommentCount != 1 {
		t.Fatalf("comment_count = %d, want 1", card.CommentCount)
	}
}

func TestListDelegationTaskCardsByTeamMessageIncludesFreshNoCommentCard(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Fresh Card Captain")
	memberID := createTeamTestAgent(t, "Fresh Card Reviewer")
	team := createTeamViaHandler(t, captainID, []string{memberID})

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/teams/"+team.ID+"/messages", map[string]any{
		"content": "@Fresh Card Captain 请拆一张还没有结果的任务卡",
	})
	req = withURLParam(req, "id", team.ID)
	testHandler.PostTeamMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("PostTeamMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	completeCaptainDelegationForTest(
		t,
		team.ID,
		captainID,
		"@Fresh Card Reviewer 请先领取任务，暂时不要写结果评论。",
	)

	var sourceMessageID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT source_team_message_id::text
		FROM issue
		WHERE assignee_id = $1 AND source_team_message_id IS NOT NULL
		ORDER BY created_at DESC LIMIT 1
	`, memberID).Scan(&sourceMessageID); err != nil {
		t.Fatalf("load delegated issue source message: %v", err)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/issues/by-team-message/"+sourceMessageID+"/cards", nil)
	req = withURLParam(req, "messageId", sourceMessageID)
	testHandler.ListDelegationTaskCardsByTeamMessage(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListDelegationTaskCardsByTeamMessage: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Cards []DelegationTaskCardResponse `json:"cards"`
		Total int                          `json:"total"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode cards: %v", err)
	}
	if resp.Total != 1 || len(resp.Cards) != 1 {
		t.Fatalf("expected one card, got total=%d cards=%+v", resp.Total, resp.Cards)
	}
	card := resp.Cards[0]
	if card.AssigneeName == nil || *card.AssigneeName != "Fresh Card Reviewer" {
		t.Fatalf("assignee name mismatch: %+v", card.AssigneeName)
	}
	if card.LatestResultPreview != nil {
		t.Fatalf("latest result preview = %q, want nil", *card.LatestResultPreview)
	}
	if card.LatestResultCommentID != nil {
		t.Fatalf("latest result comment id = %q, want nil", *card.LatestResultCommentID)
	}
	if card.CommentCount != 0 {
		t.Fatalf("comment_count = %d, want 0", card.CommentCount)
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

	// D 方案 (commit c996f62f): mission 群聊也是 team session，captain @ 派活
	// 走同一条 delegateTeamMentions → issue 卡片链路。旧 mission_assignment /
	// mission_event(member_delegated) / mission_plan_item(in_progress execute)
	// 状态机已成 dead code（createMissionDelegation 没有调用者），mission
	// 状态机回填留给 v1.3。这里改成验证 issue 卡片在 mission session 下创建。
	var memberIssueID string
	var issueDescription string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id::text, COALESCE(description, '') FROM issue
		WHERE assignee_id = $1 AND source_team_session_id::text = $2
		ORDER BY created_at DESC LIMIT 1
	`, memberID, missionResp.Mission.ChatSessionID).Scan(&memberIssueID, &issueDescription); err != nil {
		t.Fatalf("load mission delegated issue: %v", err)
	}
	if !strings.Contains(issueDescription, "第一轮实现") {
		t.Fatalf("mission issue description should carry captain's instruction, got %q", issueDescription)
	}

	var issueCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM issue
		WHERE assignee_id = $1 AND source_team_session_id::text = $2
	`, memberID, missionResp.Mission.ChatSessionID).Scan(&issueCount); err != nil {
		t.Fatalf("count mission delegated issues: %v", err)
	}
	if issueCount != 1 {
		t.Fatalf("expected one delegated issue in mission room, got %d", issueCount)
	}

	// 派出的 issue 应自动 enqueue 一条 member task（无 chat_session_id, 仅 issue_id）。
	var memberTaskCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM agent_task_queue
		WHERE agent_id = $1 AND issue_id::text = $2 AND status = 'queued'
	`, memberID, memberIssueID).Scan(&memberTaskCount); err != nil {
		t.Fatalf("count member task: %v", err)
	}
	if memberTaskCount != 1 {
		t.Fatalf("expected one queued task for delegated issue, got %d", memberTaskCount)
	}
}

func TestPromoteIdeaCreatesMissionAndMarksIdeaPromoted(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Idea Promote Captain")
	memberID := createTeamTestAgent(t, "Idea Promote Member")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/ideas", map[string]any{
		"title":       "把想法升级成 Mission",
		"description": "原始想法描述。\n需要把养护笔记带入 Mission 简报。",
		"tags":        []string{"origin", "mission"},
	})
	testHandler.CreateIdea(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateIdea: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var ideaResp IdeaDetailResponse
	if err := json.NewDecoder(w.Body).Decode(&ideaResp); err != nil {
		t.Fatalf("decode idea: %v", err)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/ideas/"+ideaResp.Idea.ID+"/notes", map[string]any{
		"kind":    "new_angle",
		"summary": "养护后的关键角度",
		"body":    "建议先确认负责人，再拆成两步执行。",
	})
	req = withURLParam(req, "id", ideaResp.Idea.ID)
	testHandler.CreateIdeaNote(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateIdeaNote: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/ideas/"+ideaResp.Idea.ID+"/promote", map[string]any{
		"title":            "想法升级后的 Mission",
		"captain_agent_id": captainID,
		"member_agent_ids": []string{memberID},
	})
	req = withURLParam(req, "id", ideaResp.Idea.ID)
	testHandler.PromoteIdea(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("PromoteIdea: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var promoteResp PromoteIdeaResponse
	if err := json.NewDecoder(w.Body).Decode(&promoteResp); err != nil {
		t.Fatalf("decode promote response: %v", err)
	}
	if promoteResp.Idea.Status != "promoted" {
		t.Fatalf("idea status = %q, want promoted", promoteResp.Idea.Status)
	}
	if promoteResp.Idea.PromotedMissionID == nil || *promoteResp.Idea.PromotedMissionID != promoteResp.Mission.Mission.ID {
		t.Fatalf("promoted_mission_id mismatch: idea=%+v mission=%s", promoteResp.Idea.PromotedMissionID, promoteResp.Mission.Mission.ID)
	}
	if promoteResp.Mission.Mission.Title != "想法升级后的 Mission" {
		t.Fatalf("mission title = %q", promoteResp.Mission.Mission.Title)
	}
	if promoteResp.Mission.Mission.CaptainAgentID != captainID {
		t.Fatalf("captain id = %s, want %s", promoteResp.Mission.Mission.CaptainAgentID, captainID)
	}
	if len(promoteResp.Mission.PlanItems) == 0 {
		t.Fatal("expected promoted mission to have plan items")
	}

	var messageBody string
	if err := testPool.QueryRow(context.Background(), `
		SELECT content FROM chat_message
		WHERE chat_session_id = $1 AND role = 'user'
		ORDER BY created_at ASC LIMIT 1
	`, promoteResp.Mission.Mission.ChatSessionID).Scan(&messageBody); err != nil {
		t.Fatalf("load promoted mission brief: %v", err)
	}
	if !strings.Contains(messageBody, "来源 Idea") || !strings.Contains(messageBody, "养护后的关键角度") {
		t.Fatalf("mission brief should include idea context and nurture notes, got: %s", messageBody)
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

	// D 方案 (commit c996f62f): captain @ 派活落地为 issue 卡片，member 拿到的
	// task 走 issue assignment 链路（无 chat_session_id）。旧 mission_assignment
	// 状态机已成 dead code，故 mission_event(assignment_completed) /
	// agent_event(mission_assignment_completed) / mission_reflection memory
	// 都不再写入。这些产品行为转 v1.3 follow-up（recordMissionAgentCompletion
	// 早 return），这里改成验证 D 方案的实际产物：完成 issue task 时按
	// invariant 写一条 agent comment 到 issue（task.go:715-734）。
	var memberIssueID string
	var memberTaskID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT t.id::text, t.issue_id::text
		FROM agent_task_queue t
		JOIN issue i ON i.id = t.issue_id
		WHERE t.agent_id = $1
		  AND i.source_team_session_id::text = $2
		  AND t.status = 'queued'
		ORDER BY t.created_at DESC LIMIT 1
	`, memberID, missionResp.Mission.ChatSessionID).Scan(&memberTaskID, &memberIssueID); err != nil {
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

	var commentCount int
	var commentBody string
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*), COALESCE(MAX(content), '')
		FROM comment
		WHERE issue_id::text = $1
		  AND author_type = 'agent'
		  AND author_id = $2
	`, memberIssueID, memberID).Scan(&commentCount, &commentBody); err != nil {
		t.Fatalf("count agent comments on issue: %v", err)
	}
	if commentCount < 1 {
		t.Fatalf("expected at least one agent comment on completed issue, got %d", commentCount)
	}
	if !strings.Contains(commentBody, "已实现核心流程") {
		t.Fatalf("comment should carry agent's final output, got %q", commentBody)
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

func TestAdjournCouncilSessionRelaysConclusionToSourceChat(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	convenerAgentID := createTeamTestAgent(t, "Council Convener")
	memberAID := createTeamTestAgent(t, "Council Member A")
	memberBID := createTeamTestAgent(t, "Council Member B")

	// Direct Chat session that will be the council's "source" — adjourn must
	// drop a recap message back into this chat so the user sees the result
	// in the original thread.
	var chatSessionID string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO chat_session (workspace_id, agent_id, creator_id, title)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, parseUUID(testWorkspaceID), parseUUID(convenerAgentID), parseUUID(testUserID), "Source Direct Chat").Scan(&chatSessionID); err != nil {
		t.Fatalf("insert source chat: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM chat_session WHERE id = $1`, parseUUID(chatSessionID))
	})

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/council-sessions", map[string]any{
		"topic":                  "营养库 schema 单表 vs 分表",
		"convener_agent_id":      convenerAgentID,
		"source_chat_session_id": chatSessionID,
		"participant_agent_ids":  []string{memberAID, memberBID},
	})
	testHandler.CreateCouncilSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateCouncilSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created CouncilSessionDetailResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode council create response: %v", err)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/council-sessions/"+created.Session.ID+"/adjourn", map[string]any{
		"conclusion": "选单表方案，按 client_id 加复合索引。",
	})
	req = withURLParam(req, "id", created.Session.ID)
	testHandler.AdjournCouncilSession(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("AdjournCouncilSession: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var relayContent string
	if err := testPool.QueryRow(context.Background(), `
		SELECT content FROM chat_message
		WHERE chat_session_id = $1 AND role = 'assistant'
		ORDER BY created_at DESC LIMIT 1
	`, parseUUID(chatSessionID)).Scan(&relayContent); err != nil {
		t.Fatalf("load relay message from source chat: %v", err)
	}

	for _, want := range []string{
		"Council 结论",
		"营养库 schema 单表 vs 分表",
		"Council Convener",
		"Council Member A",
		"Council Member B",
		"选单表方案",
	} {
		if !strings.Contains(relayContent, want) {
			t.Fatalf("relay message missing %q\nfull content:\n%s", want, relayContent)
		}
	}
}

func TestToolBindingMissionLifecycle(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Tool Binding Captain")

	// Need a real Mission to bind against. Cheaper than wiring CreateMission
	// from scratch — just stamp one row via SQL with the minimum required FKs.
	var teamID, sessionID, missionID string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO team (workspace_id, name, description, captain_agent_id, created_by_user_id)
		VALUES ($1, 'Tool Binding Team', '', $2, $3)
		RETURNING id
	`, parseUUID(testWorkspaceID), parseUUID(captainID), parseUUID(testUserID)).Scan(&teamID); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO chat_session (workspace_id, team_id, agent_id, creator_id, title)
		VALUES ($1, $2, NULL, $3, 'Tool Binding Mission Room')
		RETURNING id
	`, parseUUID(testWorkspaceID), parseUUID(teamID), parseUUID(testUserID)).Scan(&sessionID); err != nil {
		t.Fatalf("insert chat_session: %v", err)
	}
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO mission (workspace_id, team_id, captain_agent_id, created_by_user_id, title, prompt, status, risk_level, execution_mode, chat_session_id)
		VALUES ($1, $2, $3, $4, 'Tool Binding Mission', 'check tool bindings', 'planning', 'low', 'auto', $5)
		RETURNING id
	`, parseUUID(testWorkspaceID), parseUUID(teamID), parseUUID(captainID), parseUUID(testUserID), parseUUID(sessionID)).Scan(&missionID); err != nil {
		t.Fatalf("insert mission: %v", err)
	}
	// mission.team_id is ON DELETE RESTRICT, so the cleanup must drop mission
	// (and any tool_binding pointing at it) BEFORE the team. Reverse order
	// of insert. chat_session falls away via CASCADE on team delete.
	t.Cleanup(func() {
		ctx := context.Background()
		testPool.Exec(ctx, `DELETE FROM tool_binding WHERE mission_id = $1`, parseUUID(missionID))
		testPool.Exec(ctx, `DELETE FROM mission WHERE id = $1`, parseUUID(missionID))
		testPool.Exec(ctx, `DELETE FROM team WHERE id = $1`, parseUUID(teamID))
	})

	// Create a binding scoped to this mission.
	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/tool-bindings", map[string]any{
		"tool_type":    "lark_doc",
		"resource_ref": map[string]any{"url": "https://x.feishu.cn/docx/abc"},
		"label":        "营养库 PRD",
		"mission_id":   missionID,
	})
	testHandler.CreateToolBinding(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateToolBinding: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created ToolBindingResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode binding: %v", err)
	}
	if created.WriteEnabled {
		t.Fatal("new binding must default write_enabled=false (PRD §14.9.3)")
	}
	if created.MissionID == nil || *created.MissionID != missionID {
		t.Fatalf("mission_id mismatch: got %+v want %s", created.MissionID, missionID)
	}

	// Listing by mission_id must surface this row and only this row's subject.
	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/tool-bindings?mission_id="+missionID, nil)
	testHandler.ListToolBindings(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListToolBindings: expected 200, got %d", w.Code)
	}
	var listed ListToolBindingsResponse
	if err := json.NewDecoder(w.Body).Decode(&listed); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if listed.Total != 1 || listed.Bindings[0].ID != created.ID {
		t.Fatalf("expected exactly the new binding in mission filter, got %+v", listed)
	}

	// Toggle write_enabled — that is the high-risk action and must be its own
	// explicit step, not implicit at create time.
	w = httptest.NewRecorder()
	req = newRequest(http.MethodPatch, "/api/tool-bindings/"+created.ID, map[string]any{
		"write_enabled": true,
	})
	req = withURLParam(req, "id", created.ID)
	testHandler.UpdateToolBinding(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateToolBinding: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var updated ToolBindingResponse
	if err := json.NewDecoder(w.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated: %v", err)
	}
	if !updated.WriteEnabled {
		t.Fatal("write_enabled must flip to true after explicit PATCH")
	}

	// Reject creating a binding without any subject (CHECK on the table).
	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/tool-bindings", map[string]any{
		"tool_type":    "lark_doc",
		"resource_ref": map[string]any{"url": "https://x.feishu.cn/docx/zzz"},
	})
	testHandler.CreateToolBinding(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing-subject create should be 400, got %d", w.Code)
	}

	// Reject invalid tool_type.
	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/tool-bindings", map[string]any{
		"tool_type":    "slack_channel",
		"resource_ref": map[string]any{"url": "x"},
		"mission_id":   missionID,
	})
	testHandler.CreateToolBinding(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid tool_type should be 400, got %d", w.Code)
	}

	// Delete — and verify it disappears from the mission filter.
	w = httptest.NewRecorder()
	req = newRequest(http.MethodDelete, "/api/tool-bindings/"+created.ID, nil)
	req = withURLParam(req, "id", created.ID)
	testHandler.DeleteToolBinding(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("DeleteToolBinding: expected 204, got %d: %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/tool-bindings?mission_id="+missionID, nil)
	testHandler.ListToolBindings(w, req)
	var afterDelete ListToolBindingsResponse
	json.NewDecoder(w.Body).Decode(&afterDelete)
	if afterDelete.Total != 0 {
		t.Fatalf("expected mission filter to be empty after delete, got %d", afterDelete.Total)
	}
}

func TestToolBindingRejectsSubjectOutsideWorkspace(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	// A well-formed UUID that doesn't exist in this workspace stands in for
	// the cross-workspace case — the require* helpers can't tell the two
	// apart and reject both. Prevents a caller from leaking another
	// workspace's binding URLs by guessing its mission_id / idea_id.
	const foreignID = "00000000-0000-0000-0000-0000000000aa"

	t.Run("create with foreign mission_id is 404", func(t *testing.T) {
		w := httptest.NewRecorder()
		req := newRequest(http.MethodPost, "/api/tool-bindings", map[string]any{
			"tool_type":    "lark_doc",
			"resource_ref": map[string]any{"url": "https://x.feishu.cn/docx/abc"},
			"mission_id":   foreignID,
		})
		testHandler.CreateToolBinding(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for foreign mission_id, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("list with foreign mission_id is 404", func(t *testing.T) {
		w := httptest.NewRecorder()
		req := newRequest(http.MethodGet, "/api/tool-bindings?mission_id="+foreignID, nil)
		testHandler.ListToolBindings(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for foreign mission filter, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("create with foreign idea_id is 404", func(t *testing.T) {
		w := httptest.NewRecorder()
		req := newRequest(http.MethodPost, "/api/tool-bindings", map[string]any{
			"tool_type":    "obsidian_note",
			"resource_ref": map[string]any{"path": "/x.md"},
			"idea_id":      foreignID,
		})
		testHandler.CreateToolBinding(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for foreign idea_id, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("create with foreign council_session_id is 404", func(t *testing.T) {
		w := httptest.NewRecorder()
		req := newRequest(http.MethodPost, "/api/tool-bindings", map[string]any{
			"tool_type":          "figma_file",
			"resource_ref":       map[string]any{"url": "https://figma.com/f"},
			"council_session_id": foreignID,
		})
		testHandler.CreateToolBinding(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for foreign council_session_id, got %d: %s", w.Code, w.Body.String())
		}
	})
}

func TestExplorationRejectsRelatedRefsOutsideWorkspace(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	const foreignID = "00000000-0000-0000-0000-0000000000bb"

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/explorations", map[string]any{
		"topic":              "should fail",
		"related_mission_id": foreignID,
	})
	testHandler.CreateExploration(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("foreign related_mission_id: expected 404, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/explorations", map[string]any{
		"topic":           "should fail",
		"related_idea_id": foreignID,
	})
	testHandler.CreateExploration(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("foreign related_idea_id: expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAdjournCouncilSessionWithoutSourceChatStaysSilent(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	convenerAgentID := createTeamTestAgent(t, "Solo Convener")

	// No source_chat_session_id — adjourn should not write to any chat.
	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/council-sessions", map[string]any{
		"topic":             "Standalone session",
		"convener_agent_id": convenerAgentID,
	})
	testHandler.CreateCouncilSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateCouncilSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created CouncilSessionDetailResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode council create response: %v", err)
	}

	// Snapshot global chat_message count before adjourn — adjourn must not
	// add any message anywhere when there is no source chat.
	var beforeCount int
	if err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM chat_message`).Scan(&beforeCount); err != nil {
		t.Fatalf("count chat_message before: %v", err)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/council-sessions/"+created.Session.ID+"/adjourn", map[string]any{
		"conclusion": "no relay expected",
	})
	req = withURLParam(req, "id", created.Session.ID)
	testHandler.AdjournCouncilSession(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("AdjournCouncilSession: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var afterCount int
	if err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM chat_message`).Scan(&afterCount); err != nil {
		t.Fatalf("count chat_message after: %v", err)
	}
	if afterCount != beforeCount {
		t.Fatalf("expected no chat_message rows added when source_chat_session_id is null; before=%d after=%d", beforeCount, afterCount)
	}
}
