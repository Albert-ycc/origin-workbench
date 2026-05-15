package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func requireResponseProjectID(t *testing.T, got *string, want string, label string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s project_id = nil, want %s", label, want)
	}
	if *got != want {
		t.Fatalf("%s project_id = %s, want %s", label, *got, want)
	}
}

func TestMissionProjectIDCreateListAndForeignReject(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	project := createTeamTestProject(t, "Mission Project Filter")
	foreign := createForeignProjectFixture(t, "mission-project-id")
	captainID := createTeamTestAgent(t, "Mission Project Captain")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/missions?workspace_id="+testWorkspaceID, map[string]any{
		"title":            "Mission with Project",
		"prompt":           "Create a mission tied to a project.",
		"captain_agent_id": captainID,
		"project_id":       project.ID,
	})
	testHandler.CreateMission(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMission: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created MissionDetailResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode mission: %v", err)
	}
	requireResponseProjectID(t, created.Mission.ProjectID, project.ID, "created mission")

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/missions?workspace_id="+testWorkspaceID+"&project_id="+project.ID, nil)
	testHandler.ListMissions(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListMissions: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list ListMissionsResponse
	if err := json.NewDecoder(w.Body).Decode(&list); err != nil {
		t.Fatalf("decode mission list: %v", err)
	}
	found := false
	for _, mission := range list.Missions {
		requireResponseProjectID(t, mission.ProjectID, project.ID, "listed mission")
		if mission.ID == created.Mission.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("created mission %s not found in project-filtered list", created.Mission.ID)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/missions?workspace_id="+testWorkspaceID, map[string]any{
		"title":            "Mission with Foreign Project",
		"prompt":           "Should reject cross-workspace project.",
		"captain_agent_id": captainID,
		"project_id":       foreign.ProjectID,
	})
	testHandler.CreateMission(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateMission foreign project: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestIdeaProjectIDCreateListAndPromoteInherits(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	project := createTeamTestProject(t, "Idea Project Filter")
	foreign := createForeignProjectFixture(t, "idea-project-id")
	captainID := createTeamTestAgent(t, "Idea Project Captain")
	memberID := createTeamTestAgent(t, "Idea Project Member")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/ideas?workspace_id="+testWorkspaceID, map[string]any{
		"title":       "Idea with Project",
		"description": "Create an idea tied to a project.",
		"project_id":  project.ID,
	})
	testHandler.CreateIdea(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateIdea: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created IdeaDetailResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode idea: %v", err)
	}
	requireResponseProjectID(t, created.Idea.ProjectID, project.ID, "created idea")

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/ideas?workspace_id="+testWorkspaceID+"&project_id="+project.ID, nil)
	testHandler.ListIdeas(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListIdeas: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list ListIdeasResponse
	if err := json.NewDecoder(w.Body).Decode(&list); err != nil {
		t.Fatalf("decode idea list: %v", err)
	}
	found := false
	for _, idea := range list.Ideas {
		requireResponseProjectID(t, idea.ProjectID, project.ID, "listed idea")
		if idea.ID == created.Idea.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("created idea %s not found in project-filtered list", created.Idea.ID)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/ideas/"+created.Idea.ID+"/promote", map[string]any{
		"title":            "Mission from Project Idea",
		"captain_agent_id": captainID,
		"member_agent_ids": []string{memberID},
	})
	req = withURLParam(req, "id", created.Idea.ID)
	testHandler.PromoteIdea(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("PromoteIdea: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var promoted PromoteIdeaResponse
	if err := json.NewDecoder(w.Body).Decode(&promoted); err != nil {
		t.Fatalf("decode promote response: %v", err)
	}
	requireResponseProjectID(t, promoted.Idea.ProjectID, project.ID, "promoted idea")
	requireResponseProjectID(t, promoted.Mission.Mission.ProjectID, project.ID, "promoted mission")

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/ideas?workspace_id="+testWorkspaceID, map[string]any{
		"title":       "Idea with Foreign Project",
		"description": "Should reject cross-workspace project.",
		"project_id":  foreign.ProjectID,
	})
	testHandler.CreateIdea(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateIdea foreign project: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestExplorationProjectIDCreateListAndForeignReject(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	project := createTeamTestProject(t, "Exploration Project Filter")
	foreign := createForeignProjectFixture(t, "exploration-project-id")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/explorations?workspace_id="+testWorkspaceID, map[string]any{
		"topic":      "Exploration with Project",
		"question":   "How should project scoped explorations behave?",
		"project_id": project.ID,
	})
	testHandler.CreateExploration(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateExploration: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created ExplorationDetailResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode exploration: %v", err)
	}
	requireResponseProjectID(t, created.Exploration.ProjectID, project.ID, "created exploration")

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/explorations?workspace_id="+testWorkspaceID+"&project_id="+project.ID, nil)
	testHandler.ListExplorations(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListExplorations: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list ListExplorationsResponse
	if err := json.NewDecoder(w.Body).Decode(&list); err != nil {
		t.Fatalf("decode exploration list: %v", err)
	}
	found := false
	for _, exploration := range list.Explorations {
		requireResponseProjectID(t, exploration.ProjectID, project.ID, "listed exploration")
		if exploration.ID == created.Exploration.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("created exploration %s not found in project-filtered list", created.Exploration.ID)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/explorations?workspace_id="+testWorkspaceID, map[string]any{
		"topic":      "Exploration with Foreign Project",
		"question":   "Should reject cross-workspace project.",
		"project_id": foreign.ProjectID,
	})
	testHandler.CreateExploration(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateExploration foreign project: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}
