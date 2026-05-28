package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCreateCouncilWithStrategyRoundTrip verifies that strategy JSON
// passed at create time is persisted, returned in the response, and
// preserved across an UpdateCouncilSession patch that only mutates a
// nested key (role_perspectives).
func TestCreateCouncilWithStrategyRoundTrip(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentA := createTeamTestAgent(t, "Roundtable Agent A")
	agentB := createTeamTestAgent(t, "Roundtable Agent B")

	createStrategy := map[string]any{
		"roundtable_type":  "brainstorm",
		"framework_id":     "brainstorm",
		"framework_label":  "双钻模型 + 六顶思考帽",
		"expected_output":  "3 个候选方向 + 主要风险",
		"participant_roles": []map[string]any{
			{"agent_id": agentA, "role": "机会发现者"},
			{"agent_id": agentB, "role": "风险预警员"},
		},
		"role_perspectives": []any{},
		"disagreements":     []any{},
	}

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/council-sessions", map[string]any{
		"topic":                  "Strategy round-trip",
		"mode":                   "relay",
		"participant_agent_ids":  []string{agentA, agentB},
		"strategy":               createStrategy,
	})
	testHandler.CreateCouncilSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateCouncilSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created CouncilSessionDetailResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode council session: %v", err)
	}
	t.Cleanup(func() {
		// Clean up via SQL because DeleteCouncilSession requires a
		// URL param plumb. The participant row cascades.
		_, _ = testPool.Exec(context.Background(), `DELETE FROM council_session WHERE id = $1`, parseUUID(created.Session.ID))
	})

	if len(created.Session.Strategy) == 0 || string(created.Session.Strategy) == "{}" {
		t.Fatalf("strategy missing from response: %s", string(created.Session.Strategy))
	}
	var roundTrip map[string]any
	if err := json.Unmarshal(created.Session.Strategy, &roundTrip); err != nil {
		t.Fatalf("strategy is not valid JSON: %v — %s", err, string(created.Session.Strategy))
	}
	if rt, _ := roundTrip["roundtable_type"].(string); rt != "brainstorm" {
		t.Fatalf("strategy.roundtable_type round-trip: want brainstorm, got %v", roundTrip["roundtable_type"])
	}
	if eo, _ := roundTrip["expected_output"].(string); eo != "3 个候选方向 + 主要风险" {
		t.Fatalf("strategy.expected_output round-trip: want '3 个候选方向 + 主要风险', got %v", roundTrip["expected_output"])
	}

	// PATCH adds a role_perspective and verifies the rest of the
	// strategy survives. The handler accepts the full strategy
	// object, not a JSON-patch — clients merge client-side.
	updatedStrategy := map[string]any{
		"roundtable_type":  "brainstorm",
		"framework_id":     "brainstorm",
		"framework_label":  "双钻模型 + 六顶思考帽",
		"expected_output":  "3 个候选方向 + 主要风险",
		"participant_roles": roundTrip["participant_roles"],
		"role_perspectives": []map[string]any{
			{
				"agent_id":      agentA,
				"role":          "机会发现者",
				"position":      "应该先做最小切片",
				"evidence":      "用户访谈 3 次都说慢",
				"self_rebuttal": "可能样本量不够",
				"risk_level":    "medium",
				"suggestion":    "2 周做出最小可见版本",
			},
		},
		"disagreements": []any{},
	}
	wu := httptest.NewRecorder()
	patchReq := newRequest(http.MethodPatch, "/api/council-sessions/"+created.Session.ID, map[string]any{
		"strategy": updatedStrategy,
	})
	patchReq = withURLParam(patchReq, "id", created.Session.ID)
	testHandler.UpdateCouncilSession(wu, patchReq)
	if wu.Code != http.StatusOK {
		t.Fatalf("UpdateCouncilSession: expected 200, got %d: %s", wu.Code, wu.Body.String())
	}
	var updated CouncilSessionResponse
	if err := json.NewDecoder(wu.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated council: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(updated.Strategy, &got); err != nil {
		t.Fatalf("updated strategy is not valid JSON: %v", err)
	}
	perspectives, _ := got["role_perspectives"].([]any)
	if len(perspectives) != 1 {
		t.Fatalf("role_perspectives round-trip: want 1, got %d", len(perspectives))
	}
	first, _ := perspectives[0].(map[string]any)
	if first["position"] != "应该先做最小切片" {
		t.Fatalf("role_perspectives[0].position: want '应该先做最小切片', got %v", first["position"])
	}
}

// TestCreateCouncilRejectsNonObjectStrategy verifies that a JSON value
// at the strategy top level that isn't an object is rejected with 400.
func TestCreateCouncilRejectsNonObjectStrategy(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createTeamTestAgent(t, "Strategy Guard Agent")

	w := httptest.NewRecorder()
	// Pass a raw JSON array literal — http handler should refuse it.
	req := newRequest(http.MethodPost, "/api/council-sessions", map[string]any{
		"topic":                 "must reject non-object strategy",
		"mode":                  "relay",
		"participant_agent_ids": []string{agentID},
		"strategy":              []any{"this", "is", "an", "array"},
	})
	testHandler.CreateCouncilSession(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateCouncilSession: expected 400 for non-object strategy, got %d: %s", w.Code, w.Body.String())
	}
}

// TestCreateMissionWithSourceCouncilIDRoundTrip verifies that
// source_council_id is persisted and exposed on subsequent reads, and
// that referencing a non-existent council fails validation.
func TestCreateMissionWithSourceCouncilIDRoundTrip(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	captainID := createTeamTestAgent(t, "Mission From Council Captain")
	memberID := createTeamTestAgent(t, "Mission From Council Member")

	// First, create a council we can reference.
	wc := httptest.NewRecorder()
	cReq := newRequest(http.MethodPost, "/api/council-sessions", map[string]any{
		"topic":                 "Mission source pointer",
		"mode":                  "relay",
		"participant_agent_ids": []string{captainID, memberID},
	})
	testHandler.CreateCouncilSession(wc, cReq)
	if wc.Code != http.StatusCreated {
		t.Fatalf("CreateCouncilSession: expected 201, got %d: %s", wc.Code, wc.Body.String())
	}
	var council CouncilSessionDetailResponse
	if err := json.NewDecoder(wc.Body).Decode(&council); err != nil {
		t.Fatalf("decode council: %v", err)
	}
	councilID := council.Session.ID
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM council_session WHERE id = $1`, parseUUID(councilID))
	})

	// Create a mission that points back to that council.
	wm := httptest.NewRecorder()
	mReq := newRequest(http.MethodPost, "/api/missions", map[string]any{
		"title":             "执行 AI 圆桌结论",
		"prompt":            "把圆桌结论转成可执行计划",
		"captain_agent_id":  captainID,
		"member_agent_ids":  []string{memberID},
		"source_council_id": councilID,
	})
	testHandler.CreateMission(wm, mReq)
	if wm.Code != http.StatusCreated {
		t.Fatalf("CreateMission: expected 201, got %d: %s", wm.Code, wm.Body.String())
	}
	var mission MissionDetailResponse
	if err := json.NewDecoder(wm.Body).Decode(&mission); err != nil {
		t.Fatalf("decode mission: %v", err)
	}
	t.Cleanup(func() {
		// CreateMission enqueues a captain chat task. Subsequent
		// TestClaimTask_* tests will happily claim that orphaned task
		// and end up asserting against the wrong project. Clean both
		// up — the mission delete cascades to plan_items/assignments,
		// but not to agent_task_queue.
		_, _ = testPool.Exec(context.Background(),
			`DELETE FROM agent_task_queue WHERE chat_session_id = $1`,
			parseUUID(mission.Mission.ChatSessionID))
		_, _ = testPool.Exec(context.Background(),
			`DELETE FROM mission WHERE id = $1`,
			parseUUID(mission.Mission.ID))
	})
	if mission.Mission.SourceCouncilID == nil || *mission.Mission.SourceCouncilID != councilID {
		t.Fatalf("source_council_id round-trip: want %s, got %v", councilID, mission.Mission.SourceCouncilID)
	}

	// Reject a syntactically valid UUID that isn't a council in this workspace.
	bogus := "00000000-0000-0000-0000-000000000000"
	wb := httptest.NewRecorder()
	bReq := newRequest(http.MethodPost, "/api/missions", map[string]any{
		"title":             "must reject unknown council",
		"prompt":            "noop",
		"captain_agent_id":  captainID,
		"source_council_id": bogus,
	})
	testHandler.CreateMission(wb, bReq)
	if wb.Code != http.StatusBadRequest {
		t.Fatalf("CreateMission with bogus source_council_id: expected 400, got %d: %s", wb.Code, wb.Body.String())
	}
}
