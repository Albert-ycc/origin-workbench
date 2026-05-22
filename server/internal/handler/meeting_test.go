package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type meetingProjectFixture struct {
	AgentID   string
	TeamID    string
	ProjectID string
}

func createMeetingProjectFixture(t *testing.T, label string) meetingProjectFixture {
	t.Helper()

	agentID := createHandlerTestAgent(t, "Meeting Agent "+label, []byte("{}"))

	var teamID string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO team (workspace_id, name, description, captain_agent_id, created_by_user_id)
		VALUES ($1, $2, '', $3, $4)
		RETURNING id
	`, testWorkspaceID, "Meeting Team "+label, agentID, testUserID).Scan(&teamID); err != nil {
		t.Fatalf("create meeting team: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO team_member (team_id, agent_id, role)
		VALUES ($1, $2, 'captain')
	`, teamID, agentID); err != nil {
		t.Fatalf("create meeting team member: %v", err)
	}

	var projectID string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO project (workspace_id, team_id, title, description, status, local_dir, memory_doc)
		VALUES ($1, $2, $3, '', 'active', '/tmp/origin-meeting-test', '')
		RETURNING id
	`, testWorkspaceID, teamID, "Meeting Project "+label).Scan(&projectID); err != nil {
		t.Fatalf("create meeting project: %v", err)
	}

	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM project WHERE id = $1`, projectID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM team WHERE id = $1`, teamID)
	})

	return meetingProjectFixture{AgentID: agentID, TeamID: teamID, ProjectID: projectID}
}

func TestCreateMeetingRejectsForeignProject(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	foreign := createForeignProjectFixture(t, "meeting-project-guard")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       foreign.ProjectID,
		"title":            "跨工作区会议",
		"goal":             "验证会议项目隔离",
		"analysis_enabled": false,
		"strategy": map[string]any{
			"focus": []string{"预算", "风险"},
		},
	})
	testHandler.CreateMeetingSession(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateMeetingSession: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMeetingLifecycleAcceptsTranscriptSegments(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fixture := createMeetingProjectFixture(t, "lifecycle")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "需求评审会",
		"goal":             "识别问题、风险、反馈和既要",
		"user_role":        "产品负责人",
		"analysis_enabled": false,
		"strategy": map[string]any{
			"focus":          []string{"上线范围", "资源风险"},
			"blocked_topics": []string{"无证据猜测"},
		},
	})
	testHandler.CreateMeetingSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		ID             string         `json:"id"`
		ProjectID      string         `json:"project_id"`
		Status         string         `json:"status"`
		AnalysisStatus string         `json:"analysis_status"`
		SoundEnabled   bool           `json:"sound_enabled"`
		Strategy       map[string]any `json:"strategy"`
	}
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode created meeting: %v", err)
	}
	if created.ProjectID != fixture.ProjectID {
		t.Fatalf("meeting project mismatch: got %s want %s", created.ProjectID, fixture.ProjectID)
	}
	if created.Status != "draft" {
		t.Fatalf("new meeting status: got %q want draft", created.Status)
	}
	if created.AnalysisStatus != "paused" {
		t.Fatalf("new meeting analysis_status: got %q want paused", created.AnalysisStatus)
	}
	if created.SoundEnabled {
		t.Fatalf("sound_enabled should default to false")
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/start?workspace_id="+testWorkspaceID, nil)
	req = withURLParam(req, "id", created.ID)
	testHandler.StartMeetingSession(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("StartMeetingSession: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var started struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(w.Body).Decode(&started); err != nil {
		t.Fatalf("decode started meeting: %v", err)
	}
	if started.Status != "running" {
		t.Fatalf("started status: got %q want running", started.Status)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/transcript-segments?workspace_id="+testWorkspaceID, map[string]any{
		"seq":           1,
		"speaker_label": "客户",
		"text":          "这个版本既要赶在月底上线，又要保证全部风险都先清掉。",
		"confidence":    0.92,
		"source":        "manual",
	})
	req = withURLParam(req, "id", created.ID)
	testHandler.CreateMeetingTranscriptSegment(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingTranscriptSegment: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var segment struct {
		MeetingID    string  `json:"meeting_id"`
		Seq          int32   `json:"seq"`
		SpeakerLabel string  `json:"speaker_label"`
		Text         string  `json:"text"`
		Confidence   float64 `json:"confidence"`
	}
	if err := json.NewDecoder(w.Body).Decode(&segment); err != nil {
		t.Fatalf("decode segment: %v", err)
	}
	if segment.MeetingID != created.ID || segment.Seq != 1 || segment.Text == "" {
		t.Fatalf("unexpected transcript segment: %+v", segment)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/v13/meetings/"+created.ID+"/transcript-segments?workspace_id="+testWorkspaceID, nil)
	req = withURLParam(req, "id", created.ID)
	testHandler.ListMeetingTranscriptSegments(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListMeetingTranscriptSegments: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list struct {
		Segments []struct {
			Seq  int32  `json:"seq"`
			Text string `json:"text"`
		} `json:"segments"`
	}
	if err := json.NewDecoder(w.Body).Decode(&list); err != nil {
		t.Fatalf("decode segment list: %v", err)
	}
	if len(list.Segments) != 1 || list.Segments[0].Seq != 1 {
		t.Fatalf("unexpected segment list: %+v", list.Segments)
	}
}

func TestUpdateMeetingSessionCanSwitchASRProviderToManual(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fixture := createMeetingProjectFixture(t, "asr-fallback")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "实时转写降级测试",
		"analysis_enabled": false,
		"asr_provider":     "renderer",
	})
	testHandler.CreateMeetingSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		ID          string `json:"id"`
		ASRProvider string `json:"asr_provider"`
	}
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode created meeting: %v", err)
	}
	if created.ASRProvider != "renderer" {
		t.Fatalf("created asr_provider: got %q want renderer", created.ASRProvider)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPatch, "/api/v13/meetings/"+created.ID+"?workspace_id="+testWorkspaceID, map[string]any{
		"asr_provider": "manual",
	})
	req = withURLParam(req, "id", created.ID)
	testHandler.UpdateMeetingSession(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateMeetingSession: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var updated struct {
		ASRProvider string `json:"asr_provider"`
	}
	if err := json.NewDecoder(w.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated meeting: %v", err)
	}
	if updated.ASRProvider != "manual" {
		t.Fatalf("updated asr_provider: got %q want manual", updated.ASRProvider)
	}
}

func TestMeetingTranscriptCreatesStrongAlertWhenAnalysisEnabled(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fixture := createMeetingProjectFixture(t, "strong-alert")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "上线会",
		"goal":             "盯住上线风险",
		"analysis_enabled": true,
		"model_source":     "local",
		"strategy": map[string]any{
			"focus": []string{"上线窗口", "风险"},
		},
	})
	testHandler.CreateMeetingSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		ID             string `json:"id"`
		AnalysisStatus string `json:"analysis_status"`
	}
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode created meeting: %v", err)
	}
	if created.AnalysisStatus != "idle" {
		t.Fatalf("analysis_status: got %q want idle", created.AnalysisStatus)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/start?workspace_id="+testWorkspaceID, nil)
	req = withURLParam(req, "id", created.ID)
	testHandler.StartMeetingSession(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("StartMeetingSession: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/transcript-segments?workspace_id="+testWorkspaceID, map[string]any{
		"seq":           1,
		"speaker_label": "客户",
		"text":          "这个版本既要月底上线，又要所有风险先清零。",
		"confidence":    0.95,
		"source":        "manual",
	})
	req = withURLParam(req, "id", created.ID)
	testHandler.CreateMeetingTranscriptSegment(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingTranscriptSegment: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/v13/meetings/"+created.ID+"/insights?workspace_id="+testWorkspaceID, nil)
	req = withURLParam(req, "id", created.ID)
	testHandler.ListMeetingInsightCards(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListMeetingInsightCards: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var insights struct {
		Cards []struct {
			Type          string `json:"type"`
			Severity      string `json:"severity"`
			EvidenceQuote string `json:"evidence_quote"`
		} `json:"cards"`
	}
	if err := json.NewDecoder(w.Body).Decode(&insights); err != nil {
		t.Fatalf("decode insights: %v", err)
	}
	if len(insights.Cards) == 0 {
		t.Fatalf("expected at least one insight card")
	}
	if insights.Cards[0].Type != "tension" || insights.Cards[0].Severity != "L3" {
		t.Fatalf("unexpected strong alert card: %+v", insights.Cards[0])
	}
	if insights.Cards[0].EvidenceQuote == "" {
		t.Fatalf("expected evidence quote")
	}
}

func TestArchiveMeetingSessionRemovesMeetingFromActiveList(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fixture := createMeetingProjectFixture(t, "archive")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "待归档会议",
		"analysis_enabled": false,
	})
	testHandler.CreateMeetingSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode created meeting: %v", err)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/archive?workspace_id="+testWorkspaceID, nil)
	req = withURLParam(req, "id", created.ID)
	testHandler.ArchiveMeetingSession(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ArchiveMeetingSession: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var archived struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(w.Body).Decode(&archived); err != nil {
		t.Fatalf("decode archived meeting: %v", err)
	}
	if archived.Status != "archived" {
		t.Fatalf("archived status: got %q want archived", archived.Status)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/v13/meetings?workspace_id="+testWorkspaceID, nil)
	testHandler.ListMeetingSessions(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListMeetingSessions: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list struct {
		Meetings []struct {
			ID string `json:"id"`
		} `json:"meetings"`
	}
	if err := json.NewDecoder(w.Body).Decode(&list); err != nil {
		t.Fatalf("decode meeting list: %v", err)
	}
	for _, meeting := range list.Meetings {
		if meeting.ID == created.ID {
			t.Fatalf("archived meeting still appeared in active list")
		}
	}
}

func TestDeleteMeetingSessionRemovesMeetingAndDependents(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fixture := createMeetingProjectFixture(t, "delete")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "待删除会议",
		"goal":             "验证删除会议",
		"analysis_enabled": false,
	})
	testHandler.CreateMeetingSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode created meeting: %v", err)
	}

	req = withURLParam(newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/transcript-segments?workspace_id="+testWorkspaceID, map[string]any{
		"seq":           1,
		"text":          "这段转写应随会议删除",
		"speaker_label": "PM",
		"source":        "manual",
	}), "id", created.ID)
	w = httptest.NewRecorder()
	testHandler.CreateMeetingTranscriptSegment(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingTranscriptSegment: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	req = withURLParam(newRequest(http.MethodDelete, "/api/v13/meetings/"+created.ID+"?workspace_id="+testWorkspaceID, nil), "id", created.ID)
	w = httptest.NewRecorder()
	testHandler.DeleteMeetingSession(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("DeleteMeetingSession: expected 204, got %d: %s", w.Code, w.Body.String())
	}

	var meetingCount int
	if err := testPool.QueryRow(context.Background(), `SELECT COUNT(*) FROM meeting_session WHERE id = $1`, created.ID).Scan(&meetingCount); err != nil {
		t.Fatalf("count meeting_session: %v", err)
	}
	if meetingCount != 0 {
		t.Fatalf("expected meeting_session to be deleted, got count=%d", meetingCount)
	}

	var segmentCount int
	if err := testPool.QueryRow(context.Background(), `SELECT COUNT(*) FROM meeting_transcript_segment WHERE meeting_id = $1`, created.ID).Scan(&segmentCount); err != nil {
		t.Fatalf("count meeting_transcript_segment: %v", err)
	}
	if segmentCount != 0 {
		t.Fatalf("expected meeting transcript segments to cascade-delete, got count=%d", segmentCount)
	}
}

func TestGenerateMeetingSummaryPersistsTranscriptDigest(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fixture := createMeetingProjectFixture(t, "summary")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "会议纪要生成测试",
		"goal":             "沉淀决策、风险和行动项",
		"analysis_enabled": true,
		"model_source":     "local",
	})
	testHandler.CreateMeetingSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode created meeting: %v", err)
	}

	segments := []string{
		"决定：本期只上线实时转写和旁听 Agent。",
		"风险：麦克风权限可能阻塞首轮使用，需要产品提前验收。",
		"问题：文件转文字后是否要自动进入项目记录？",
		"行动项：产品今天补充会议纪要验收标准。",
	}
	for i, text := range segments {
		w = httptest.NewRecorder()
		req = newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/transcript-segments?workspace_id="+testWorkspaceID, map[string]any{
			"seq":           i + 1,
			"speaker_label": "现场",
			"text":          text,
			"confidence":    1,
			"source":        "manual",
		})
		req = withURLParam(req, "id", created.ID)
		testHandler.CreateMeetingTranscriptSegment(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("CreateMeetingTranscriptSegment %d: expected 201, got %d: %s", i+1, w.Code, w.Body.String())
		}
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/summary?workspace_id="+testWorkspaceID, nil)
	req = withURLParam(req, "id", created.ID)
	testHandler.GenerateMeetingSummary(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GenerateMeetingSummary: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var generated struct {
		MeetingID      string   `json:"meeting_id"`
		SummaryMd      string   `json:"summary_md"`
		Decisions      []string `json:"decisions"`
		Questions      []string `json:"questions"`
		Risks          []string `json:"risks"`
		ActionItems    []string `json:"action_items"`
		SourceSeqStart *int32   `json:"source_seq_start"`
		SourceSeqEnd   *int32   `json:"source_seq_end"`
	}
	if err := json.NewDecoder(w.Body).Decode(&generated); err != nil {
		t.Fatalf("decode generated summary: %v", err)
	}
	if generated.MeetingID != created.ID {
		t.Fatalf("summary meeting_id: got %s want %s", generated.MeetingID, created.ID)
	}
	if generated.SourceSeqStart == nil || *generated.SourceSeqStart != 1 {
		t.Fatalf("source_seq_start: got %+v want 1", generated.SourceSeqStart)
	}
	if generated.SourceSeqEnd == nil || *generated.SourceSeqEnd != 4 {
		t.Fatalf("source_seq_end: got %+v want 4", generated.SourceSeqEnd)
	}
	if !strings.Contains(generated.SummaryMd, "会议纪要生成测试") {
		t.Fatalf("summary_md should include meeting title: %s", generated.SummaryMd)
	}
	if len(generated.Decisions) == 0 || len(generated.Risks) == 0 || len(generated.Questions) == 0 || len(generated.ActionItems) == 0 {
		t.Fatalf("expected structured summary buckets, got decisions=%v risks=%v questions=%v actions=%v", generated.Decisions, generated.Risks, generated.Questions, generated.ActionItems)
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/v13/meetings/"+created.ID+"/summary?workspace_id="+testWorkspaceID, nil)
	req = withURLParam(req, "id", created.ID)
	testHandler.GetMeetingSummary(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GetMeetingSummary: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var persisted struct {
		MeetingID string `json:"meeting_id"`
		SummaryMd string `json:"summary_md"`
	}
	if err := json.NewDecoder(w.Body).Decode(&persisted); err != nil {
		t.Fatalf("decode persisted summary: %v", err)
	}
	if persisted.MeetingID != created.ID || persisted.SummaryMd != generated.SummaryMd {
		t.Fatalf("persisted summary mismatch: %+v vs %+v", persisted, generated)
	}
}
