# Card-first Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert delegated team-chat work into a card-first flow where new member results stay inside task cards instead of inflating the main chat.

**Architecture:** Keep delegated work backed by the existing `issue` model and `source_team_message_id` linkage. Stop creating completion chat messages for new delegated issue completions, add a card-shaped API summary, and move the team chat UI from inline task chips to a compact delegation board with a detail drawer backed by issue comments.

**Tech Stack:** Go, Chi router, sqlc, pgx, React, TypeScript, TanStack Query, Vitest, Tailwind, existing `@multica/ui` sheet/dialog components.

---

## File Structure

### Backend

- Modify `server/internal/service/task.go`
  - Copy `session.ProjectID` into delegated issues in `createTeamMentionIssue`.
  - Change `MirrorIssueCompletionToTeamSession` so it publishes a lightweight update event and does not create a long assistant `chat_message`.
- Modify `server/internal/handler/team_test.go`
  - Extend delegation tests for project propagation.
  - Add regression coverage that delegated issue completion no longer inserts a mirrored assistant message.
- Modify `server/pkg/db/queries/issue.sql`
  - Add `ListDelegationTaskCardsByTeamMessage`, a card summary query that joins assignee agent and latest assignee comment.
- Regenerate `server/pkg/db/generated/issue.sql.go`
  - Use `make sqlc` from `server/` if available; otherwise use `sqlc generate` from `server/`.
- Modify `server/internal/handler/issue.go`
  - Add `DelegationTaskCardResponse`.
  - Add `ListDelegationTaskCardsByTeamMessage`.
- Modify `server/cmd/server/router.go`
  - Add a workspace-scoped route for the card summary endpoint.

### Frontend Core

- Modify `packages/core/types/issue.ts`
  - Add `DelegationTaskCard` and `DelegationTaskCardStatus`.
- Modify `packages/core/api/client.ts`
  - Add `listDelegationTaskCards(messageId)`.
- Modify `packages/core/teams/queries.ts`
  - Add `teamKeys.delegationCards(wsId, messageId)` and `delegationTaskCardsOptions(wsId, messageId)`.
- Modify `packages/core/teams/index.ts`
  - Export the new query helper.
- Modify `packages/core/realtime/use-realtime-sync.ts`
  - Invalidate delegation-card queries when team task update payloads or linked issue updates arrive.

### Frontend Views

- Create `packages/views/teams/components/delegation-board.tsx`
  - Fetch task cards and render summary/filter/list.
- Create `packages/views/teams/components/delegation-task-row.tsx`
  - Render one compact task row.
- Create `packages/views/teams/components/delegation-task-detail-drawer.tsx`
  - Show issue detail, latest result, and comments in a side drawer/sheet.
- Create `packages/views/teams/components/delegation-task-comments.tsx`
  - Reuse `useIssueTimeline` for the card detail comments section.
- Create `packages/views/teams/components/delegation-status.ts`
  - Centralize status labels, tone classes, and progress grouping.
- Modify `packages/views/teams/team-detail-page.tsx`
  - Replace inline `TeamTaskCardList` / `TeamTaskCard` with `DelegationBoard`.
  - Remove task-card status constants from this large page file after the extraction.
- Create `packages/views/teams/components/delegation-board.test.tsx`
  - Cover compact board rendering and drawer access to long results.

---

## Task 1: Backend Regression Tests For Card-first Completion

**Files:**
- Modify: `server/internal/handler/team_test.go`

- [ ] **Step 1: Add project creation helper for team delegation tests**

Add this helper near `createTeamViaHandler`:

```go
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
```

- [ ] **Step 2: Add a helper that completes the captain delegation**

Add this helper near `TestCompleteTeamCaptainMessageDelegatesMentionedMember`:

```go
func completeCaptainDelegationForTest(t *testing.T, teamID string, captainID string, output string) string {
	t.Helper()
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
```

Then replace the duplicated captain-claim block inside `TestCompleteTeamCaptainMessageDelegatesMentionedMember` with:

```go
captainTaskID := completeCaptainDelegationForTest(
	t,
	team.ID,
	captainID,
	"@Frontend Delegate 请你负责实现前端交互验证，并把结论回到群里。",
)
```

The `teamID` argument is included so follow-up tests can share the helper without changing call sites; it is intentionally unused in the first helper version.

- [ ] **Step 3: Add failing project propagation test**

Add this test after `TestCompleteTeamCaptainMessageDelegatesMentionedMember`:

```go
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
	if _, err := testHandler.TaskService.StartTask(context.Background(), task.ID); err != nil {
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
```

- [ ] **Step 4: Add failing no-mirror completion test**

Add this test after the project propagation test:

```go
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
	if err := testPool.QueryRow(context.Background(), `
		SELECT i.id::text, i.source_team_session_id::text
		FROM issue i
		WHERE i.assignee_id = $1 AND i.source_team_message_id IS NOT NULL
		ORDER BY i.created_at DESC LIMIT 1
	`, memberID).Scan(&issueID, &sessionID); err != nil {
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
	testHandler.TaskService.MirrorIssueCompletionToTeamSession(context.Background(), issue)

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
```

- [ ] **Step 5: Run the focused backend test and verify it fails**

Run:

```bash
cd /Users/albert/.multica/server/server
go test ./internal/handler -run 'TestTeamDelegatedIssueCopiesProjectIDFromSession|TestTeamDelegatedIssueCompletionDoesNotCreateMainChatMessage' -count=1
```

Expected:

- Project propagation test fails because `createTeamMentionIssue` currently sends an empty `ProjectID`.
- No-mirror test fails because `MirrorIssueCompletionToTeamSession` currently creates a chat message containing the long comment.

---

## Task 2: Backend Behavior Change

**Files:**
- Modify: `server/internal/service/task.go`
- Test: `server/internal/handler/team_test.go`

- [ ] **Step 1: Propagate project id into delegated issues**

In `createTeamMentionIssue`, replace:

```go
ProjectID:           pgtype.UUID{},
```

with:

```go
ProjectID:           session.ProjectID,
```

- [ ] **Step 2: Replace mirrored chat insertion with lightweight event publishing**

Replace the body of `MirrorIssueCompletionToTeamSession` with:

```go
func (s *TaskService) MirrorIssueCompletionToTeamSession(ctx context.Context, issue db.Issue) {
	if !issue.SourceTeamSessionID.Valid {
		return
	}
	session, err := s.Queries.GetChatSession(ctx, issue.SourceTeamSessionID)
	if err != nil {
		return
	}
	if !session.TeamID.Valid {
		return
	}

	payload := map[string]any{
		"team_id":                util.UUIDToString(session.TeamID),
		"chat_session_id":        util.UUIDToString(session.ID),
		"issue_id":               util.UUIDToString(issue.ID),
		"source_team_session_id": util.UUIDToString(issue.SourceTeamSessionID),
		"event":                  "team_task_completed",
	}
	if issue.SourceTeamMessageID.Valid {
		payload["source_team_message_id"] = util.UUIDToString(issue.SourceTeamMessageID)
	}
	if session.ProjectID.Valid {
		payload["project_id"] = util.UUIDToString(session.ProjectID)
	}

	s.Bus.Publish(events.Event{
		Type:        protocol.EventTeamMessageCreated,
		WorkspaceID: util.UUIDToString(session.WorkspaceID),
		ActorType:   "agent",
		ActorID:     util.UUIDToString(issue.AssigneeID),
		Payload:     payload,
	})
}
```

This keeps the existing method name so handler call sites do not churn in this task. A later cleanup may rename it to `PublishTeamTaskCompletion`.

- [ ] **Step 3: Run focused backend tests**

Run:

```bash
cd /Users/albert/.multica/server/server
go test ./internal/handler -run 'TestCompleteTeamCaptainMessageDelegatesMentionedMember|TestTeamDelegatedIssueCopiesProjectIDFromSession|TestTeamDelegatedIssueCompletionDoesNotCreateMainChatMessage' -count=1
```

Expected: PASS.

- [ ] **Step 4: Run service tests touched by recent team message payload logic**

Run:

```bash
cd /Users/albert/.multica/server/server
go test ./internal/service -run 'TestTeamMessageEventPayloadForSessionIncludesProjectID' -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit backend behavior change**

```bash
cd /Users/albert/.multica/server
git add server/internal/service/task.go server/internal/handler/team_test.go
git commit -m "fix(teams): keep delegated results in task cards"
```

---

## Task 3: Backend Card Summary API

**Files:**
- Modify: `server/pkg/db/queries/issue.sql`
- Modify generated: `server/pkg/db/generated/issue.sql.go`
- Modify: `server/internal/handler/issue.go`
- Modify: `server/cmd/server/router.go`
- Test: `server/internal/handler/team_test.go`

- [ ] **Step 1: Add sqlc query for task-card summaries**

Append this query after `ListIssuesByTeamMessage` in `server/pkg/db/queries/issue.sql`:

```sql
-- name: ListDelegationTaskCardsByTeamMessage :many
SELECT
    i.id AS issue_id,
    i.workspace_id,
    i.number,
    i.title,
    i.status,
    i.assignee_id,
    i.source_team_message_id,
    i.source_team_session_id,
    i.project_id,
    i.updated_at,
    a.name AS assignee_name,
    a.avatar_url AS assignee_avatar_url,
    lc.id AS latest_result_comment_id,
    lc.content AS latest_result_content,
    COALESCE(cc.comment_count, 0)::bigint AS comment_count
FROM issue i
LEFT JOIN agent a
    ON a.id = i.assignee_id
LEFT JOIN LATERAL (
    SELECT c.id, c.content
    FROM comment c
    WHERE c.issue_id = i.id
      AND c.workspace_id = i.workspace_id
      AND c.author_type = 'agent'
      AND c.author_id = i.assignee_id
    ORDER BY c.created_at DESC
    LIMIT 1
) lc ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS comment_count
    FROM comment c
    WHERE c.issue_id = i.id
      AND c.workspace_id = i.workspace_id
) cc ON true
WHERE i.source_team_message_id = $1
ORDER BY i.created_at ASC;
```

- [ ] **Step 2: Regenerate sqlc output**

Run:

```bash
cd /Users/albert/.multica/server/server
make sqlc
```

If `make sqlc` is not available in this checkout, run:

```bash
cd /Users/albert/.multica/server/server
sqlc generate
```

Expected: `server/pkg/db/generated/issue.sql.go` contains `ListDelegationTaskCardsByTeamMessage`.

- [ ] **Step 3: Add handler response type**

In `server/internal/handler/issue.go`, add near `IssueResponse`:

```go
type DelegationTaskCardResponse struct {
	IssueID               string  `json:"issue_id"`
	IssueKey              string  `json:"issue_key"`
	WorkspaceID           string  `json:"workspace_id"`
	Number                int32   `json:"number"`
	Title                 string  `json:"title"`
	Status                string  `json:"status"`
	AssigneeID            *string `json:"assignee_id"`
	AssigneeName          *string `json:"assignee_name"`
	AssigneeAvatarURL     *string `json:"assignee_avatar_url"`
	SourceTeamMessageID   *string `json:"source_team_message_id"`
	SourceTeamSessionID   *string `json:"source_team_session_id"`
	ProjectID             *string `json:"project_id"`
	LatestResultPreview   *string `json:"latest_result_preview"`
	LatestResultCommentID *string `json:"latest_result_comment_id"`
	CommentCount          int64   `json:"comment_count"`
	UpdatedAt             string  `json:"updated_at"`
}
```

Then add helper functions below `issueToResponse`:

```go
func trimDelegationPreview(content string) *string {
	text := strings.TrimSpace(content)
	if text == "" {
		return nil
	}
	rs := []rune(text)
	if len(rs) > 120 {
		text = string(rs[:120]) + "..."
	}
	return &text
}

func delegationTaskCardToResponse(row db.ListDelegationTaskCardsByTeamMessageRow, prefix string) DelegationTaskCardResponse {
	assigneeID := uuidToPtr(row.AssigneeID)
	var assigneeName *string
	if row.AssigneeName.Valid {
		assigneeName = &row.AssigneeName.String
	}
	var assigneeAvatarURL *string
	if row.AssigneeAvatarUrl.Valid {
		assigneeAvatarURL = &row.AssigneeAvatarUrl.String
	}
	var latestCommentID *string
	if row.LatestResultCommentID.Valid {
		v := uuidToString(row.LatestResultCommentID)
		latestCommentID = &v
	}
	var latestPreview *string
	if row.LatestResultContent.Valid {
		latestPreview = trimDelegationPreview(row.LatestResultContent.String)
	}
	return DelegationTaskCardResponse{
		IssueID:               uuidToString(row.IssueID),
		IssueKey:              fmt.Sprintf("%s-%d", prefix, row.Number),
		WorkspaceID:           uuidToString(row.WorkspaceID),
		Number:                row.Number,
		Title:                 row.Title,
		Status:                row.Status,
		AssigneeID:            assigneeID,
		AssigneeName:          assigneeName,
		AssigneeAvatarURL:     assigneeAvatarURL,
		SourceTeamMessageID:   uuidToPtr(row.SourceTeamMessageID),
		SourceTeamSessionID:   uuidToPtr(row.SourceTeamSessionID),
		ProjectID:             uuidToPtr(row.ProjectID),
		LatestResultPreview:   latestPreview,
		LatestResultCommentID: latestCommentID,
		CommentCount:          row.CommentCount,
		UpdatedAt:             timestampToString(row.UpdatedAt),
	}
}
```

If sqlc emits `pgtype.Int8` for `comment_count`, use:

```go
CommentCount: row.CommentCount.Int64,
```

instead of `row.CommentCount`.

- [ ] **Step 4: Add card-list handler**

Add this handler near `ListIssuesByTeamMessage`:

```go
func (h *Handler) ListDelegationTaskCardsByTeamMessage(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	mid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "messageId"), "message id")
	if !ok {
		return
	}
	rows, err := h.Queries.ListDelegationTaskCardsByTeamMessage(r.Context(), pgtype.UUID{Bytes: mid.Bytes, Valid: true})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list delegation task cards")
		return
	}
	prefix := h.getIssuePrefix(r.Context(), wsUUID)
	cards := make([]DelegationTaskCardResponse, 0, len(rows))
	for _, row := range rows {
		if !uuidEqual(row.WorkspaceID, wsUUID) {
			continue
		}
		cards = append(cards, delegationTaskCardToResponse(row, prefix))
	}
	writeJSON(w, http.StatusOK, map[string]any{"cards": cards, "total": len(cards)})
}
```

- [ ] **Step 5: Register route**

In `server/cmd/server/router.go`, inside the workspace-scoped `/api/issues` route, add this line next to the existing `by-team-message` route:

```go
r.Get("/by-team-message/{messageId}/cards", h.ListDelegationTaskCardsByTeamMessage)
```

- [ ] **Step 6: Add handler test for card summaries**

Add this test to `server/internal/handler/team_test.go`:

```go
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
```

- [ ] **Step 7: Run focused card API tests**

Run:

```bash
cd /Users/albert/.multica/server/server
go test ./internal/handler -run 'TestListDelegationTaskCardsByTeamMessageIncludesLatestResultPreview' -count=1
```

Expected: PASS.

- [ ] **Step 8: Run broader backend checks**

Run:

```bash
cd /Users/albert/.multica/server/server
go test ./internal/handler ./internal/service
```

Expected: PASS.

- [ ] **Step 9: Commit card API**

```bash
cd /Users/albert/.multica/server
git add server/pkg/db/queries/issue.sql server/pkg/db/generated/issue.sql.go server/internal/handler/issue.go server/cmd/server/router.go server/internal/handler/team_test.go
git commit -m "feat(teams): expose delegation task cards"
```

---

## Task 4: Frontend Core Types, API, And Query Keys

**Files:**
- Modify: `packages/core/types/issue.ts`
- Modify: `packages/core/api/client.ts`
- Modify: `packages/core/teams/queries.ts`
- Modify: `packages/core/teams/index.ts`

- [ ] **Step 1: Add card type**

In `packages/core/types/issue.ts`, add after `Issue`:

```ts
export type DelegationTaskCardStatus = IssueStatus;

export interface DelegationTaskCard {
  issue_id: string;
  issue_key: string;
  workspace_id: string;
  number: number;
  title: string;
  status: DelegationTaskCardStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_avatar_url: string | null;
  source_team_message_id: string | null;
  source_team_session_id: string | null;
  project_id: string | null;
  latest_result_preview: string | null;
  latest_result_comment_id: string | null;
  comment_count: number;
  updated_at: string;
}
```

- [ ] **Step 2: Add API client method**

In `packages/core/api/client.ts`, next to `listIssuesByTeamMessage`, add:

```ts
async listDelegationTaskCards(messageId: string): Promise<{ cards: DelegationTaskCard[]; total: number }> {
  return this.fetch(`/api/issues/by-team-message/${messageId}/cards`);
}
```

Also add `DelegationTaskCard` to the type import from `../types` at the top of the file.

- [ ] **Step 3: Add team query key and options**

In `packages/core/teams/queries.ts`, update `teamKeys`:

```ts
delegationCards: (wsId: string, messageId: string) =>
  [...teamKeys.all(wsId), "delegation-cards", messageId] as const,
delegationCardsAll: (wsId: string) =>
  [...teamKeys.all(wsId), "delegation-cards"] as const,
```

Add:

```ts
export function delegationTaskCardsOptions(wsId: string, messageId: string) {
  return queryOptions({
    queryKey: teamKeys.delegationCards(wsId, messageId),
    queryFn: () => api.listDelegationTaskCards(messageId),
    select: (data) => data.cards,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const cards = query.state.data?.cards;
      if (!cards || cards.length === 0) return 4000;
      const allDone = cards.every((card) =>
        card.status === "done" ||
        card.status === "in_review" ||
        card.status === "cancelled"
      );
      return allDone ? false : 4000;
    },
  });
}
```

- [ ] **Step 4: Export the query helper**

In `packages/core/teams/index.ts`, add `delegationTaskCardsOptions` to the export list:

```ts
export {
  teamKeys,
  teamListOptions,
  teamDetailOptions,
  teamMessagesOptions,
  delegationTaskCardsOptions,
} from "./queries";
```

- [ ] **Step 5: Run core typecheck**

Run:

```bash
cd /Users/albert/.multica/server
pnpm --filter @multica/core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit frontend core API**

```bash
cd /Users/albert/.multica/server
git add packages/core/types/issue.ts packages/core/api/client.ts packages/core/teams/queries.ts packages/core/teams/index.ts
git commit -m "feat(core): add delegation task card queries"
```

---

## Task 5: Delegation Board UI Components

**Files:**
- Create: `packages/views/teams/components/delegation-status.ts`
- Create: `packages/views/teams/components/delegation-task-row.tsx`
- Create: `packages/views/teams/components/delegation-task-comments.tsx`
- Create: `packages/views/teams/components/delegation-task-detail-drawer.tsx`
- Create: `packages/views/teams/components/delegation-board.tsx`
- Modify: `packages/views/teams/team-detail-page.tsx`

- [ ] **Step 1: Create status helper**

Create `packages/views/teams/components/delegation-status.ts`:

```ts
import { CheckCircle2, Circle, Clock3, Loader2 } from "lucide-react";
import type { DelegationTaskCardStatus } from "@multica/core/types";

export const delegationStatusMeta: Record<
  DelegationTaskCardStatus,
  { label: string; tone: string; icon: typeof Circle; terminal: boolean; reportReady: boolean }
> = {
  backlog: { label: "待办", tone: "text-muted-foreground bg-muted/60", icon: Circle, terminal: false, reportReady: false },
  todo: { label: "等待中", tone: "text-muted-foreground bg-muted/60", icon: Circle, terminal: false, reportReady: false },
  in_progress: { label: "处理中", tone: "text-amber-500 bg-amber-500/10", icon: Loader2, terminal: false, reportReady: false },
  in_review: { label: "已回报", tone: "text-emerald-500 bg-emerald-500/10", icon: CheckCircle2, terminal: true, reportReady: true },
  done: { label: "已确认", tone: "text-emerald-500 bg-emerald-500/10", icon: CheckCircle2, terminal: true, reportReady: true },
  blocked: { label: "卡点", tone: "text-destructive bg-destructive/10", icon: Clock3, terminal: false, reportReady: false },
  cancelled: { label: "已取消", tone: "text-muted-foreground bg-muted/60", icon: Circle, terminal: true, reportReady: false },
};

export type DelegationFilter = "all" | "active" | "reported" | "blocked";

export function filterDelegationStatus(status: DelegationTaskCardStatus, filter: DelegationFilter) {
  if (filter === "all") return true;
  if (filter === "active") return status === "todo" || status === "in_progress" || status === "backlog";
  if (filter === "reported") return status === "in_review" || status === "done";
  return status === "blocked";
}
```

- [ ] **Step 2: Create compact row component**

Create `packages/views/teams/components/delegation-task-row.tsx`:

```tsx
"use client";

import type { DelegationTaskCard } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../../common/actor-avatar";
import { delegationStatusMeta } from "./delegation-status";

export function DelegationTaskRow({
  card,
  selected,
  onOpen,
}: {
  card: DelegationTaskCard;
  selected: boolean;
  onOpen: () => void;
}) {
  const meta = delegationStatusMeta[card.status];
  const Icon = meta.icon;
  const isRunning = card.status === "in_progress";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 border-t px-2.5 py-2 text-left transition-colors first:border-t-0 hover:bg-muted/50",
        selected && "bg-muted/60",
      )}
    >
      {card.assignee_id ? (
        <ActorAvatar
          actorType="agent"
          actorId={card.assignee_id}
          size={22}
          className="shrink-0 rounded-full"
        />
      ) : (
        <div className="size-[22px] shrink-0 rounded-full bg-muted" />
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12px] font-medium">
            {card.assignee_name ?? "未指派"}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {card.issue_key}
          </span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {card.latest_result_preview || card.title}
        </div>
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
          meta.tone,
        )}
      >
        <Icon className={cn("size-3", isRunning && "animate-spin")} />
        {meta.label}
      </span>
    </button>
  );
}
```

- [ ] **Step 3: Create comments wrapper**

Create `packages/views/teams/components/delegation-task-comments.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { useIssueTimeline } from "../../issues/hooks";
import { Markdown } from "../../common/markdown";

export function DelegationTaskComments({
  issueId,
  userId,
}: {
  issueId: string;
  userId?: string | null;
}) {
  const [draft, setDraft] = useState("");
  const { entries, submitComment, submitting } = useIssueTimeline(issueId, userId ?? undefined);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        {entries.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            还没有回报。
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="rounded-md border bg-background p-3">
              <div className="mb-1 text-[11px] text-muted-foreground">
                {entry.author_name ?? entry.author_type}
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{entry.content}</Markdown>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2 border-t pt-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="继续追问或补充说明..."
          className="min-h-10 resize-none text-sm"
        />
        <Button
          type="button"
          size="icon"
          disabled={!draft.trim() || submitting || !userId}
          onClick={async () => {
            const content = draft.trim();
            if (!content) return;
            await submitComment(content);
            setDraft("");
          }}
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
```

If `TimelineEntry` does not include `author_name`, replace that header with:

```tsx
{entry.author_type === "agent" ? "Agent" : "成员"}
```

- [ ] **Step 4: Create detail drawer**

Create `packages/views/teams/components/delegation-task-detail-drawer.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import type { DelegationTaskCard } from "@multica/core/types";
import { useWorkspaceId } from "@multica/core/hooks";
import { issueDetailOptions } from "@multica/core/issues/queries";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@multica/ui/components/ui/sheet";
import { Markdown } from "../../common/markdown";
import { DelegationTaskComments } from "./delegation-task-comments";
import { delegationStatusMeta } from "./delegation-status";

export function DelegationTaskDetailDrawer({
  card,
  open,
  onOpenChange,
  userId,
}: {
  card: DelegationTaskCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string | null;
}) {
  const wsId = useWorkspaceId();
  const { data: issue } = useQuery({
    ...issueDetailOptions(wsId, card?.issue_id ?? ""),
    enabled: open && !!card,
  });
  const meta = card ? delegationStatusMeta[card.status] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[560px] max-w-[92vw] flex-col gap-0 p-0">
        {card && meta && (
          <>
            <SheetHeader className="border-b px-5 py-4 text-left">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{card.issue_key}</span>
                <span>{meta.label}</span>
              </div>
              <SheetTitle className="line-clamp-2 text-base">{card.title}</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-5 py-4">
              <section className="rounded-md bg-muted/50 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">任务说明</div>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Markdown>{issue?.description || card.title}</Markdown>
                </div>
              </section>
              <section className="flex min-h-0 flex-1 flex-col">
                <div className="mb-2 text-xs font-medium text-muted-foreground">回报与评论</div>
                <DelegationTaskComments issueId={card.issue_id} userId={userId} />
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Create board component**

Create `packages/views/teams/components/delegation-board.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { delegationTaskCardsOptions } from "@multica/core/teams";
import { useWorkspaceId } from "@multica/core/hooks";
import type { DelegationTaskCard } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { DelegationTaskDetailDrawer } from "./delegation-task-detail-drawer";
import { DelegationTaskRow } from "./delegation-task-row";
import { type DelegationFilter, filterDelegationStatus } from "./delegation-status";

const filterLabels: Record<DelegationFilter, string> = {
  all: "全部",
  active: "处理中",
  reported: "已回报",
  blocked: "卡点",
};

export function DelegationBoard({
  messageId,
  userId,
}: {
  messageId: string;
  userId?: string | null;
}) {
  const wsId = useWorkspaceId();
  const [filter, setFilter] = useState<DelegationFilter>("all");
  const [selected, setSelected] = useState<DelegationTaskCard | null>(null);
  const { data: cards = [], isLoading } = useQuery(delegationTaskCardsOptions(wsId, messageId));

  const counts = useMemo(() => {
    return {
      reported: cards.filter((card) => card.status === "in_review" || card.status === "done").length,
      active: cards.filter((card) => card.status === "todo" || card.status === "in_progress" || card.status === "backlog").length,
      blocked: cards.filter((card) => card.status === "blocked").length,
    };
  }, [cards]);

  const visibleCards = cards.filter((card) => filterDelegationStatus(card.status, filter));
  if (isLoading || cards.length === 0) return null;

  return (
    <div className="mt-2 overflow-hidden rounded-lg border bg-background/80">
      <div className="flex flex-wrap items-center gap-2 border-b px-2.5 py-2">
        <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
          派出的任务 · {cards.length} 张
        </div>
        <div className="ml-auto flex items-center gap-1 text-[10.5px] text-muted-foreground">
          <span>{counts.reported} 已回报</span>
          <span>·</span>
          <span>{counts.active} 处理中</span>
          {counts.blocked > 0 && (
            <>
              <span>·</span>
              <span className="text-destructive">{counts.blocked} 卡点</span>
            </>
          )}
        </div>
        <div className="flex w-full gap-1">
          {(Object.keys(filterLabels) as DelegationFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground",
                filter === key && "bg-muted text-foreground",
              )}
            >
              {filterLabels[key]}
            </button>
          ))}
        </div>
      </div>
      <div>
        {visibleCards.map((card) => (
          <DelegationTaskRow
            key={card.issue_id}
            card={card}
            selected={selected?.issue_id === card.issue_id}
            onOpen={() => setSelected(card)}
          />
        ))}
      </div>
      <DelegationTaskDetailDrawer
        card={selected}
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        userId={userId}
      />
    </div>
  );
}
```

- [ ] **Step 6: Replace inline card list in team detail page**

In `packages/views/teams/team-detail-page.tsx`:

1. Add import:

```ts
import { DelegationBoard } from "./components/delegation-board";
```

2. Remove unused imports after extraction:

```ts
CheckCircle2,
Circle,
Clock3,
Loader2,
```

3. Replace:

```tsx
{isCaptain && agentById && (
  <TeamTaskCardList messageId={message.id} agentById={agentById} />
)}
```

with:

```tsx
{isCaptain && (
  <DelegationBoard messageId={message.id} userId={currentUserId} />
)}
```

4. Add `currentUserId` to `Message` props and pass it from the message loop.

5. Delete the old local `TeamTaskCardList`, `TeamTaskCard`, and `taskStatusMeta` definitions.

- [ ] **Step 7: Run views typecheck**

Run:

```bash
cd /Users/albert/.multica/server
pnpm --filter @multica/views typecheck
```

Expected: PASS.

---

## Task 6: Frontend Tests For Board Behavior

**Files:**
- Create: `packages/views/teams/components/delegation-board.test.tsx`

- [ ] **Step 1: Add component test**

Create `packages/views/teams/components/delegation-board.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DelegationTaskCard, Issue } from "@multica/core/types";
import { DelegationBoard } from "./delegation-board";

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

const cards: DelegationTaskCard[] = [
  {
    issue_id: "issue-1",
    issue_key: "FAI-1",
    workspace_id: "ws-1",
    number: 1,
    title: "评审 PRD 技术可行性",
    status: "in_review",
    assignee_id: "agent-1",
    assignee_name: "技术架构师",
    assignee_avatar_url: null,
    source_team_message_id: "message-1",
    source_team_session_id: "session-1",
    project_id: "project-1",
    latest_result_preview: "建议补充实体关系和权限边界。",
    latest_result_comment_id: "comment-1",
    comment_count: 1,
    updated_at: "2026-05-06T00:00:00Z",
  },
];

const issue: Issue = {
  id: "issue-1",
  workspace_id: "ws-1",
  number: 1,
  identifier: "FAI-1",
  title: "评审 PRD 技术可行性",
  description: "请从技术架构角度评审这份 PRD。",
  status: "in_review",
  priority: "medium",
  assignee_type: "agent",
  assignee_id: "agent-1",
  creator_type: "agent",
  creator_id: "captain-1",
  parent_issue_id: null,
  project_id: "project-1",
  position: 0,
  due_date: null,
  created_at: "2026-05-06T00:00:00Z",
  updated_at: "2026-05-06T00:00:00Z",
};

const apiMock = vi.hoisted(() => ({
  listDelegationTaskCards: vi.fn().mockResolvedValue({ cards, total: 1 }),
  getIssue: vi.fn().mockResolvedValue(issue),
  listTimeline: vi.fn().mockResolvedValue([
    {
      id: "comment-1",
      issue_id: "issue-1",
      workspace_id: "ws-1",
      author_type: "agent",
      author_id: "agent-1",
      content: "完整的技术架构评审正文应该在详情里展示。",
      type: "comment",
      parent_id: null,
      created_at: "2026-05-06T00:00:00Z",
      updated_at: "2026-05-06T00:00:00Z",
    },
  ]),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({
  api: apiMock,
}));

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: ({ actorId }: { actorId: string }) => <span data-testid="avatar">{actorId}</span>,
}));

vi.mock("../../common/markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DelegationBoard messageId="message-1" userId="user-1" />
    </QueryClientProvider>,
  );
}

describe("DelegationBoard", () => {
  it("renders compact task cards and opens the long result in detail", async () => {
    renderBoard();
    expect(await screen.findByText("派出的任务 · 1 张")).toBeInTheDocument();
    expect(screen.getByText("技术架构师")).toBeInTheDocument();
    expect(screen.getByText("建议补充实体关系和权限边界。")).toBeInTheDocument();

    fireEvent.click(screen.getByText("技术架构师"));

    await waitFor(() => {
      expect(screen.getByText("完整的技术架构评审正文应该在详情里展示。")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run focused frontend test**

Run:

```bash
cd /Users/albert/.multica/server
pnpm --filter @multica/views test -- teams/components/delegation-board.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit frontend board UI**

```bash
cd /Users/albert/.multica/server
git add packages/views/teams/components/delegation-status.ts packages/views/teams/components/delegation-task-row.tsx packages/views/teams/components/delegation-task-comments.tsx packages/views/teams/components/delegation-task-detail-drawer.tsx packages/views/teams/components/delegation-board.tsx packages/views/teams/components/delegation-board.test.tsx packages/views/teams/team-detail-page.tsx
git commit -m "feat(teams): render delegation tasks as board"
```

---

## Task 7: Realtime Invalidation For Delegation Cards

**Files:**
- Modify: `packages/core/realtime/use-realtime-sync.ts`
- Test manually with existing local app after implementation

- [ ] **Step 1: Add card invalidation helper**

Inside `useRealtimeSync`, near existing issue handlers, add:

```ts
const invalidateDelegationCards = (messageId?: string | null) => {
  const wsId = getCurrentWsId();
  if (!wsId) return;
  if (messageId) {
    qc.invalidateQueries({ queryKey: teamKeys.delegationCards(wsId, messageId) });
  } else {
    qc.invalidateQueries({ queryKey: teamKeys.delegationCardsAll(wsId) });
  }
};
```

- [ ] **Step 2: Invalidate cards on linked issue updates**

In the `issue:updated` handler, after `onIssueUpdated(...)`, add:

```ts
invalidateDelegationCards(issue.source_team_message_id);
```

- [ ] **Step 3: Invalidate cards on team task completion payloads**

In the `team:message_created` handler, add this before the message branch returns:

```ts
if (payload.event === "team_task_completed") {
  invalidateDelegationCards(payload.source_team_message_id);
}
```

Update `TeamMessageCreatedPayload` in `packages/core/types/events.ts`:

```ts
source_team_message_id?: string;
issue_id?: string;
event?: string;
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
cd /Users/albert/.multica/server
pnpm --filter @multica/core typecheck
pnpm --filter @multica/views typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit realtime update**

```bash
cd /Users/albert/.multica/server
git add packages/core/realtime/use-realtime-sync.ts packages/core/types/events.ts
git commit -m "fix(realtime): refresh delegation task cards"
```

---

## Task 8: End-to-end Verification

**Files:**
- No planned source edits

- [ ] **Step 1: Run backend checks**

Run:

```bash
cd /Users/albert/.multica/server/server
go test ./internal/handler ./internal/service
```

Expected: PASS.

- [ ] **Step 2: Run frontend checks**

Run:

```bash
cd /Users/albert/.multica/server
pnpm --filter @multica/core typecheck
pnpm --filter @multica/views typecheck
pnpm --filter @multica/views test -- teams/components/delegation-board.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Rebuild graphify code graph if code files changed**

Run:

```bash
cd /Users/albert/.multica/server
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: graph rebuild succeeds. If the local `graphify` module is still missing, record the exact error in the final implementation report.

- [ ] **Step 4: Rebuild backend container**

Run:

```bash
cd /Users/albert/.multica/server
docker compose -p multica -f docker-compose.selfhost.yml -f docker-compose.selfhost.build.yml up -d --build backend
```

Expected: backend container restarts and the daemon reconnects.

- [ ] **Step 5: Restart Origin app**

Run:

```bash
osascript -e 'quit app "Origin"' && sleep 2 && open -a /Users/albert/Applications/Origin.app
```

Expected: Origin opens to the local self-hosted workspace.

- [ ] **Step 6: Manual UI acceptance**

In Origin:

1. Open `项目工作区`.
2. Use a project team chat with several member agents.
3. Send a request that causes the captain to mention multiple members.
4. Confirm the captain reply renders a compact delegation board.
5. Confirm member completions update card status to `已回报`.
6. Confirm no new long member-result bubbles are created in the main chat.
7. Open a task row and confirm the full markdown result appears in the drawer.
8. Confirm old historical `✅ @成员...` messages still appear unchanged in prior test conversations.

- [ ] **Step 7: Final integration commit if any verification fixes were needed**

If verification required small fixes in the board surface, commit only the exact touched files. For example, when the only fixes are in the board and realtime code:

```bash
cd /Users/albert/.multica/server
git status --short
git add packages/views/teams/components/delegation-board.tsx packages/views/teams/components/delegation-board.test.tsx packages/core/realtime/use-realtime-sync.ts
git commit -m "fix(teams): polish delegation card flow"
```

If `git status --short` shows different files, stage those exact paths explicitly and do not use `git add .`.

---

## Self-review

### Spec Coverage

- Main chat remains compact: Tasks 2, 5, and 8.
- Existing issue model reused: Tasks 2 and 3.
- Historical messages preserved: Task 2 only changes future completion behavior; Task 8 verifies old messages.
- Project id propagation: Tasks 1 and 2.
- Card list summary API: Task 3.
- Detail view backed by issue comments: Task 5.
- Realtime card refresh: Task 7.
- Tests and verification: Tasks 1, 3, 6, and 8.

### Type Consistency

- Backend endpoint uses `/api/issues/by-team-message/{messageId}/cards`.
- Frontend client method is `listDelegationTaskCards(messageId)`.
- Query key is `teamKeys.delegationCards(wsId, messageId)`.
- UI data type is `DelegationTaskCard`.
- Event payload key is `source_team_message_id`.

### Execution Notes

- Keep commits small and in the order above.
- Do not migrate historical messages.
- Do not remove `ListIssuesByTeamMessage`; keep it for compatibility until no caller uses it.
- If `Sheet` behavior is awkward inside the existing desktop app shell, switch `DelegationTaskDetailDrawer` to `Dialog` with the same props and data flow. Keep the compact board unchanged.
