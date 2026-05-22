package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type foreignProjectFixture struct {
	WorkspaceID string
	AgentID     string
	TeamID      string
	ProjectID   string
}

func createForeignProjectFixture(t *testing.T, label string) foreignProjectFixture {
	t.Helper()

	ctx := context.Background()
	suffix := time.Now().UnixNano()
	slug := fmt.Sprintf("foreign-%s-%d", label, suffix)

	var workspaceID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, '', 'FRG')
		RETURNING id
	`, "Foreign "+label, slug).Scan(&workspaceID); err != nil {
		t.Fatalf("create foreign workspace: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM project WHERE workspace_id = $1`, workspaceID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM team WHERE workspace_id = $1`, workspaceID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM agent WHERE workspace_id = $1`, workspaceID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM agent_runtime WHERE workspace_id = $1`, workspaceID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, workspaceID)
	})

	var runtimeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status,
			device_info, metadata, owner_id, last_seen_at
		)
		VALUES ($1, NULL, $2, 'cloud', 'handler_test_foreign', 'online', $3, '{}'::jsonb, $4, now())
		RETURNING id
	`, workspaceID, "Foreign Runtime "+label, "foreign runtime", testUserID).Scan(&runtimeID); err != nil {
		t.Fatalf("create foreign runtime: %v", err)
	}

	var agentID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO agent (
			workspace_id, name, description, runtime_mode, runtime_config,
			runtime_id, visibility, max_concurrent_tasks, owner_id
		)
		VALUES ($1, $2, '', 'cloud', '{}'::jsonb, $3, 'workspace', 1, $4)
		RETURNING id
	`, workspaceID, "Foreign Agent "+label, runtimeID, testUserID).Scan(&agentID); err != nil {
		t.Fatalf("create foreign agent: %v", err)
	}

	var teamID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO team (workspace_id, name, description, captain_agent_id, created_by_user_id)
		VALUES ($1, $2, '', $3, $4)
		RETURNING id
	`, workspaceID, "Foreign Team "+label, agentID, testUserID).Scan(&teamID); err != nil {
		t.Fatalf("create foreign team: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO team_member (team_id, agent_id, role)
		VALUES ($1, $2, 'captain')
	`, teamID, agentID); err != nil {
		t.Fatalf("create foreign team member: %v", err)
	}

	var projectID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO project (workspace_id, title, status, team_id, local_dir, memory_doc)
		VALUES ($1, $2, 'active', $3, '/tmp/foreign-project', '')
		RETURNING id
	`, workspaceID, "Foreign Project "+label, teamID).Scan(&projectID); err != nil {
		t.Fatalf("create foreign project: %v", err)
	}

	return foreignProjectFixture{
		WorkspaceID: workspaceID,
		AgentID:     agentID,
		TeamID:      teamID,
		ProjectID:   projectID,
	}
}

func TestCreateProjectV12RejectsCrossWorkspaceTeamAndAgents(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	foreign := createForeignProjectFixture(t, "project-guard")

	tests := []struct {
		name string
		body map[string]any
	}{
		{
			name: "foreign explicit team",
			body: map[string]any{
				"title":     "Should reject foreign team",
				"local_dir": "/tmp/origin-project-guard",
				"team_id":   foreign.TeamID,
			},
		},
		{
			name: "foreign agent set",
			body: map[string]any{
				"title":            "Should reject foreign agents",
				"local_dir":        "/tmp/origin-project-guard",
				"agent_ids":        []string{foreign.AgentID},
				"captain_agent_id": foreign.AgentID,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := newRequest(http.MethodPost, "/api/v12/projects?workspace_id="+testWorkspaceID, tc.body)
			testHandler.CreateProjectV12(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("CreateProjectV12: expected 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestCreateProjectV12RejectsArchivedAgent(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	archivedAgentID := createHandlerTestAgent(t, "Archived Project Agent", []byte("{}"))
	if _, err := testPool.Exec(context.Background(), `UPDATE agent SET archived_at = now() WHERE id = $1`, archivedAgentID); err != nil {
		t.Fatalf("archive test agent: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v12/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title":            "Should reject archived agent",
		"local_dir":        "/tmp/origin-project-guard",
		"agent_ids":        []string{archivedAgentID},
		"captain_agent_id": archivedAgentID,
	})
	testHandler.CreateProjectV12(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateProjectV12: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteProjectV12RemovesProjectFromList(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fixture := createMeetingProjectFixture(t, "project-delete")

	w := httptest.NewRecorder()
	req := withURLParam(newRequest(http.MethodDelete, "/api/v12/projects/"+fixture.ProjectID+"?workspace_id="+testWorkspaceID, nil), "id", fixture.ProjectID)
	testHandler.DeleteProjectV12(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("DeleteProjectV12: expected 204, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/v12/projects?workspace_id="+testWorkspaceID, nil)
	testHandler.ListProjectsV12(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListProjectsV12: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var list struct {
		Projects []struct {
			ID string `json:"id"`
		} `json:"projects"`
	}
	if err := json.NewDecoder(w.Body).Decode(&list); err != nil {
		t.Fatalf("decode project list: %v", err)
	}
	for _, project := range list.Projects {
		if project.ID == fixture.ProjectID {
			t.Fatalf("deleted project still appeared in project list")
		}
	}
}

func TestIssueRejectsForeignProjectIDOnCreateAndUpdate(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	foreign := createForeignProjectFixture(t, "issue-project-guard")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":      "Should reject foreign project on create",
		"status":     "todo",
		"priority":   "medium",
		"project_id": foreign.ProjectID,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateIssue: expected 400, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":    "Local issue for foreign project update guard",
		"status":   "todo",
		"priority": "medium",
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateIssue local fixture: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created IssueResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode created issue: %v", err)
	}
	t.Cleanup(func() {
		r := newRequest(http.MethodDelete, "/api/issues/"+created.ID, nil)
		r = withURLParam(r, "id", created.ID)
		testHandler.DeleteIssue(httptest.NewRecorder(), r)
	})

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPut, "/api/issues/"+created.ID, map[string]any{
		"project_id": foreign.ProjectID,
	})
	req = withURLParam(req, "id", created.ID)
	testHandler.UpdateIssue(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("UpdateIssue: expected 400, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/issues/batch-update?workspace_id="+testWorkspaceID, map[string]any{
		"issue_ids": []string{created.ID},
		"updates": map[string]any{
			"project_id": foreign.ProjectID,
		},
	})
	testHandler.BatchUpdateIssues(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("BatchUpdateIssues: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var batchResp struct {
		Updated int `json:"updated"`
	}
	if err := json.NewDecoder(w.Body).Decode(&batchResp); err != nil {
		t.Fatalf("decode batch response: %v", err)
	}
	if batchResp.Updated != 0 {
		t.Fatalf("BatchUpdateIssues: expected updated=0 for foreign project, got %d", batchResp.Updated)
	}
}

func TestFindOrCreateTeamForAgentsDedupesConcurrentAgentSet(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createHandlerTestAgent(t, "Concurrent Captain", []byte("{}"))
	memberID := createHandlerTestAgent(t, "Concurrent Member", []byte("{}"))
	wsUUID := parseUUID(testWorkspaceID)
	userUUID := parseUUID(testUserID)
	captainUUID := parseUUID(captainID)
	agentUUIDs := []pgtype.UUID{parseUUID(captainID), parseUUID(memberID)}

	const workers = 5
	start := make(chan struct{})
	results := make(chan string, workers)
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			team, err := testHandler.findOrCreateTeamForAgents(
				context.Background(),
				wsUUID,
				userUUID,
				captainUUID,
				agentUUIDs,
				fmt.Sprintf("Concurrent Project %d", i),
			)
			if err != nil {
				errs <- err
				return
			}
			results <- uuidToString(team.ID)
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Fatalf("findOrCreateTeamForAgents returned error: %v", err)
	}

	var first string
	seen := map[string]bool{}
	for id := range results {
		if first == "" {
			first = id
		}
		seen[id] = true
		if id != first {
			t.Fatalf("expected one reused team id %s, got %s", first, id)
		}
	}
	if len(seen) != 1 {
		t.Fatalf("expected exactly one team id, got %v", seen)
	}
	t.Cleanup(func() {
		if first != "" {
			_, _ = testPool.Exec(context.Background(), `DELETE FROM team WHERE id = $1`, first)
		}
	})
}
