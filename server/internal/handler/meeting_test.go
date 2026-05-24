package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type meetingProjectFixture struct {
	AgentID   string
	TeamID    string
	ProjectID string
}

type localASRTestStorage struct {
	dir string
}

func (s localASRTestStorage) Upload(_ context.Context, key string, data []byte, _ string, _ string) (string, error) {
	dest := filepath.Join(s.dir, key)
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return "", err
	}
	if err := os.WriteFile(dest, data, 0644); err != nil {
		return "", err
	}
	return "/uploads/" + key, nil
}

func (s localASRTestStorage) Delete(_ context.Context, _ string)       {}
func (s localASRTestStorage) DeleteKeys(_ context.Context, _ []string) {}
func (s localASRTestStorage) KeyFromURL(rawURL string) string          { return rawURL }
func (s localASRTestStorage) CdnDomain() string                        { return "" }
func (s localASRTestStorage) GetFilePath(key string) string            { return filepath.Join(s.dir, key) }
func (s localASRTestStorage) Read(_ context.Context, key string) ([]byte, error) {
	return os.ReadFile(filepath.Join(s.dir, key))
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

type meetingASRJobSnapshot struct {
	Status         string
	ErrorMessage   string
	RetryCount     int32
	SourceSeqStart *int32
	SourceSeqEnd   *int32
}

func waitForMeetingASRJobStatus(t *testing.T, meetingID string, jobID string, wantStatus string) meetingASRJobSnapshot {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	var snapshot meetingASRJobSnapshot
	for time.Now().Before(deadline) {
		err := testPool.QueryRow(context.Background(), `
			SELECT status, error_message, retry_count, source_seq_start, source_seq_end
			FROM meeting_asr_job
			WHERE id = $1 AND meeting_id = $2
		`, jobID, meetingID).Scan(
			&snapshot.Status,
			&snapshot.ErrorMessage,
			&snapshot.RetryCount,
			&snapshot.SourceSeqStart,
			&snapshot.SourceSeqEnd,
		)
		if err != nil {
			t.Fatalf("query meeting_asr_job: %v", err)
		}
		if snapshot.Status == wantStatus {
			return snapshot
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("meeting ASR job %s did not reach status %q; last snapshot=%+v", jobID, wantStatus, snapshot)
	return snapshot
}

func createMeetingForASRTest(t *testing.T, label string) (meeting db.MeetingSession, asset db.MeetingAudioAsset) {
	t.Helper()
	fixture := createMeetingProjectFixture(t, label)
	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "ASR runner " + label,
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
	meeting, err := testHandler.Queries.GetMeetingSessionInWorkspace(context.Background(), db.GetMeetingSessionInWorkspaceParams{
		ID:          parseUUID(created.ID),
		WorkspaceID: parseUUID(testWorkspaceID),
	})
	if err != nil {
		t.Fatalf("get meeting: %v", err)
	}
	asset, err = testHandler.Queries.CreateMeetingAudioAsset(context.Background(), db.CreateMeetingAudioAssetParams{
		ID:              parseUUID(uuid.NewString()),
		WorkspaceID:     meeting.WorkspaceID,
		ProjectID:       meeting.ProjectID,
		MeetingID:       meeting.ID,
		StorageKey:      "meeting-asr-test/" + label + ".webm",
		FileUrl:         "/uploads/meeting-asr-test/" + label + ".webm",
		Filename:        label + ".webm",
		ContentType:     "audio/webm",
		SizeBytes:       12,
		DurationSeconds: pgtype.Int4{Int32: 1, Valid: true},
		CreatedByUserID: parseUUID(testUserID),
	})
	if err != nil {
		t.Fatalf("create meeting audio asset: %v", err)
	}
	return meeting, asset
}

func createMeetingForTranscriptTest(t *testing.T, label string) db.MeetingSession {
	t.Helper()
	fixture := createMeetingProjectFixture(t, label)
	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "Transcript editing " + label,
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
	meeting, err := testHandler.Queries.GetMeetingSessionInWorkspace(context.Background(), db.GetMeetingSessionInWorkspaceParams{
		ID:          parseUUID(created.ID),
		WorkspaceID: parseUUID(testWorkspaceID),
	})
	if err != nil {
		t.Fatalf("get meeting: %v", err)
	}
	return meeting
}

func createTranscriptSegmentForTest(t *testing.T, meeting db.MeetingSession, seq int32, speaker string, text string) db.MeetingTranscriptSegment {
	t.Helper()
	segment, err := testHandler.Queries.CreateMeetingTranscriptSegment(context.Background(), db.CreateMeetingTranscriptSegmentParams{
		WorkspaceID:  meeting.WorkspaceID,
		ProjectID:    meeting.ProjectID,
		MeetingID:    meeting.ID,
		Seq:          seq,
		SpeakerLabel: speaker,
		Text:         text,
		Confidence:   0.9,
		Source:       "manual",
	})
	if err != nil {
		t.Fatalf("create transcript segment %d: %v", seq, err)
	}
	return segment
}

func listTranscriptSegmentsForTest(t *testing.T, meeting db.MeetingSession, limit int32) []MeetingTranscriptSegmentResponse {
	t.Helper()
	rows, err := testHandler.Queries.ListMeetingTranscriptSegments(context.Background(), db.ListMeetingTranscriptSegmentsParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		Seq:         0,
		Limit:       limit,
	})
	if err != nil {
		t.Fatalf("list transcript segments: %v", err)
	}
	segments := make([]MeetingTranscriptSegmentResponse, len(rows))
	for i, row := range rows {
		segments[i] = meetingTranscriptSegmentToResponse(row)
	}
	return segments
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

func TestMeetingTranscriptSegmentsAssignServerSeqWhenMissingOrNonPositive(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fixture := createMeetingProjectFixture(t, "server-seq")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "手动记录并发会议",
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

	cases := []struct {
		name    string
		payload map[string]any
		wantSeq int32
	}{
		{
			name: "legacy seq is preserved",
			payload: map[string]any{
				"seq":           7,
				"speaker_label": "PM",
				"text":          "前端传来的旧 seq 仍应保留。",
				"source":        "manual",
			},
			wantSeq: 7,
		},
		{
			name: "missing seq uses next",
			payload: map[string]any{
				"speaker_label": "客户",
				"text":          "没有传 seq 时由后端分配。",
				"source":        "manual",
			},
			wantSeq: 8,
		},
		{
			name: "zero seq uses next",
			payload: map[string]any{
				"seq":           0,
				"speaker_label": "客户",
				"text":          "非正 seq 也由后端分配。",
				"source":        "manual",
			},
			wantSeq: 9,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/transcript-segments?workspace_id="+testWorkspaceID, tc.payload)
			req = withURLParam(req, "id", created.ID)
			testHandler.CreateMeetingTranscriptSegment(w, req)
			if w.Code != http.StatusCreated {
				t.Fatalf("CreateMeetingTranscriptSegment: expected 201, got %d: %s", w.Code, w.Body.String())
			}
			var segment struct {
				Seq int32 `json:"seq"`
			}
			if err := json.NewDecoder(w.Body).Decode(&segment); err != nil {
				t.Fatalf("decode segment: %v", err)
			}
			if segment.Seq != tc.wantSeq {
				t.Fatalf("segment seq: got %d want %d", segment.Seq, tc.wantSeq)
			}
		})
	}
}

func TestUpdateMeetingTranscriptSegmentPersistsEditRevision(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	meeting := createMeetingForTranscriptTest(t, "edit")
	segment := createTranscriptSegmentForTest(t, meeting, 1, "客户", "原始转写")

	req := withURLParams(
		newRequest(http.MethodPatch, "/api/v13/meetings/"+uuidToString(meeting.ID)+"/transcript-segments/"+uuidToString(segment.ID)+"?workspace_id="+testWorkspaceID, map[string]any{
			"speaker_label":   "PM",
			"text":            "修正后的转写",
			"audio_offset_ms": 1200,
			"confidence":      0.77,
			"summary_invalid": true,
		}),
		"id", uuidToString(meeting.ID),
		"segmentId", uuidToString(segment.ID),
	)
	w := httptest.NewRecorder()
	testHandler.UpdateMeetingTranscriptSegment(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateMeetingTranscriptSegment: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var updated struct {
		ID            string `json:"id"`
		Seq           int32  `json:"seq"`
		SpeakerLabel  string `json:"speaker_label"`
		Text          string `json:"text"`
		AudioOffsetMs *int32 `json:"audio_offset_ms"`
		EditRevision  int32  `json:"edit_revision"`
		UpdatedAt     string `json:"updated_at"`
	}
	if err := json.NewDecoder(w.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated transcript segment: %v", err)
	}
	if updated.ID != uuidToString(segment.ID) || updated.Seq != 1 || updated.SpeakerLabel != "PM" || updated.Text != "修正后的转写" || updated.AudioOffsetMs == nil || *updated.AudioOffsetMs != 1200 || updated.EditRevision != 1 || updated.UpdatedAt == "" {
		t.Fatalf("unexpected updated transcript segment: %+v", updated)
	}
}

func TestDeleteMeetingTranscriptSegmentHidesFromList(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	meeting := createMeetingForTranscriptTest(t, "delete")
	deleted := createTranscriptSegmentForTest(t, meeting, 1, "客户", "需要删除")
	kept := createTranscriptSegmentForTest(t, meeting, 2, "客户", "保留")

	req := withURLParams(
		newRequest(http.MethodDelete, "/api/v13/meetings/"+uuidToString(meeting.ID)+"/transcript-segments/"+uuidToString(deleted.ID)+"?workspace_id="+testWorkspaceID, nil),
		"id", uuidToString(meeting.ID),
		"segmentId", uuidToString(deleted.ID),
	)
	w := httptest.NewRecorder()
	testHandler.DeleteMeetingTranscriptSegment(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("DeleteMeetingTranscriptSegment: expected 204, got %d: %s", w.Code, w.Body.String())
	}
	segments := listTranscriptSegmentsForTest(t, meeting, 10)
	if len(segments) != 1 || segments[0].ID != uuidToString(kept.ID) || segments[0].Text != "保留" {
		t.Fatalf("deleted transcript segment should be hidden from list, got %+v", segments)
	}
}

func TestSplitMeetingTranscriptSegmentShiftsFollowingSeqs(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	meeting := createMeetingForTranscriptTest(t, "split")
	segment := createTranscriptSegmentForTest(t, meeting, 1, "客户", "上半段 下半段")
	createTranscriptSegmentForTest(t, meeting, 2, "PM", "原来的第二段")

	req := withURLParams(
		newRequest(http.MethodPost, "/api/v13/meetings/"+uuidToString(meeting.ID)+"/transcript-segments/"+uuidToString(segment.ID)+"/split?workspace_id="+testWorkspaceID, map[string]any{
			"text_before":         "上半段",
			"text_after":          "下半段",
			"speaker_label_after": "客户",
		}),
		"id", uuidToString(meeting.ID),
		"segmentId", uuidToString(segment.ID),
	)
	w := httptest.NewRecorder()
	testHandler.SplitMeetingTranscriptSegment(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SplitMeetingTranscriptSegment: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var split struct {
		Segments []MeetingTranscriptSegmentResponse `json:"segments"`
	}
	if err := json.NewDecoder(w.Body).Decode(&split); err != nil {
		t.Fatalf("decode split response: %v", err)
	}
	if len(split.Segments) != 2 || split.Segments[0].Seq != 1 || split.Segments[0].Text != "上半段" || split.Segments[1].Seq != 2 || split.Segments[1].Text != "下半段" {
		t.Fatalf("unexpected split response: %+v", split)
	}
	segments := listTranscriptSegmentsForTest(t, meeting, 10)
	if len(segments) != 3 || segments[0].Text != "上半段" || segments[1].Text != "下半段" || segments[2].Seq != 3 || segments[2].Text != "原来的第二段" {
		t.Fatalf("unexpected transcript sequence after split: %+v", segments)
	}
}

func TestMergeMeetingTranscriptSegmentsKeepsFirstSeqAndHidesMergedSegment(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	meeting := createMeetingForTranscriptTest(t, "merge")
	first := createTranscriptSegmentForTest(t, meeting, 1, "客户", "第一段")
	second := createTranscriptSegmentForTest(t, meeting, 2, "PM", "第二段")

	req := withURLParams(
		newRequest(http.MethodPost, "/api/v13/meetings/"+uuidToString(meeting.ID)+"/transcript-segments/"+uuidToString(first.ID)+"/merge?workspace_id="+testWorkspaceID, map[string]any{
			"target_segment_id": uuidToString(second.ID),
		}),
		"id", uuidToString(meeting.ID),
		"segmentId", uuidToString(first.ID),
	)
	w := httptest.NewRecorder()
	testHandler.MergeMeetingTranscriptSegments(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("MergeMeetingTranscriptSegments: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var merged struct {
		Segment          MeetingTranscriptSegmentResponse `json:"segment"`
		DeletedSegmentID string                           `json:"deleted_segment_id"`
	}
	if err := json.NewDecoder(w.Body).Decode(&merged); err != nil {
		t.Fatalf("decode merge response: %v", err)
	}
	if merged.Segment.ID != uuidToString(first.ID) || merged.Segment.Seq != 1 || merged.Segment.Text != "第一段\n第二段" || merged.DeletedSegmentID != uuidToString(second.ID) {
		t.Fatalf("unexpected merge response: %+v", merged)
	}
	segments := listTranscriptSegmentsForTest(t, meeting, 10)
	if len(segments) != 1 || segments[0].ID != uuidToString(first.ID) || segments[0].Text != "第一段\n第二段" {
		t.Fatalf("unexpected transcript list after merge: %+v", segments)
	}
}

func TestGenerateMeetingSummaryIncludesSegmentsBeyondFirst1000(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	meeting := createMeetingForTranscriptTest(t, "long-summary")
	for i := int32(1); i <= 1005; i++ {
		text := "普通讨论"
		if i == 1005 {
			text = "决定：第1005段必须进入纪要"
		}
		createTranscriptSegmentForTest(t, meeting, i, "客户", text)
	}

	req := withURLParam(newRequest(http.MethodPost, "/api/v13/meetings/"+uuidToString(meeting.ID)+"/summary?workspace_id="+testWorkspaceID, nil), "id", uuidToString(meeting.ID))
	w := httptest.NewRecorder()
	testHandler.GenerateMeetingSummary(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GenerateMeetingSummary: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var summary MeetingSummaryResponse
	if err := json.NewDecoder(w.Body).Decode(&summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary.SourceSeqStart == nil || *summary.SourceSeqStart != 1 || summary.SourceSeqEnd == nil || *summary.SourceSeqEnd != 1005 {
		t.Fatalf("summary source range should cover all segments, got %+v", summary)
	}
	if !strings.Contains(strings.Join(summary.Decisions, "\n"), "第1005段必须进入纪要") {
		t.Fatalf("summary decisions should include sentinel beyond first 1000 segments: %+v", summary.Decisions)
	}
	if !strings.Contains(summary.SummaryMd, "第 1 到第 1005 段") {
		t.Fatalf("summary markdown should show full transcript range, got %q", summary.SummaryMd)
	}
	var chunkCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM meeting_summary_chunk WHERE meeting_id = $1
	`, meeting.ID).Scan(&chunkCount); err != nil {
		t.Fatalf("count summary chunks: %v", err)
	}
	if chunkCount < 2 {
		t.Fatalf("expected long summary to persist multiple chunks, got %d", chunkCount)
	}
}

func TestMeetingAudioAssetUploadPersistsAndLists(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	origStorage := testHandler.Storage
	testHandler.Storage = &mockStorage{}
	defer func() { testHandler.Storage = origStorage }()

	fixture := createMeetingProjectFixture(t, "audio-asset")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "客户录音会议",
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

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "customer-call.webm")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("fake webm audio bytes")); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("duration_seconds", "4"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/audio-assets?workspace_id="+testWorkspaceID, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-User-ID", testUserID)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	req = withURLParam(req, "id", created.ID)
	w = httptest.NewRecorder()
	testHandler.UploadMeetingAudioAsset(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("UploadMeetingAudioAsset: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var uploaded struct {
		ID              string `json:"id"`
		MeetingID       string `json:"meeting_id"`
		Filename        string `json:"filename"`
		ContentType     string `json:"content_type"`
		DurationSeconds int32  `json:"duration_seconds"`
		DownloadURL     string `json:"download_url"`
	}
	if err := json.NewDecoder(w.Body).Decode(&uploaded); err != nil {
		t.Fatalf("decode uploaded audio asset: %v", err)
	}
	if uploaded.ID == "" || uploaded.MeetingID != created.ID || uploaded.Filename != "customer-call.webm" {
		t.Fatalf("unexpected uploaded asset: %+v", uploaded)
	}
	if uploaded.ContentType != "audio/webm" || uploaded.DurationSeconds != 4 || uploaded.DownloadURL == "" {
		t.Fatalf("unexpected uploaded asset metadata: %+v", uploaded)
	}

	req = withURLParam(newRequest(http.MethodGet, "/api/v13/meetings/"+created.ID+"/audio-assets?workspace_id="+testWorkspaceID, nil), "id", created.ID)
	w = httptest.NewRecorder()
	testHandler.ListMeetingAudioAssets(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListMeetingAudioAssets: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list struct {
		Assets []struct {
			ID string `json:"id"`
		} `json:"assets"`
		Total int `json:"total"`
	}
	if err := json.NewDecoder(w.Body).Decode(&list); err != nil {
		t.Fatalf("decode audio asset list: %v", err)
	}
	if list.Total != 1 || len(list.Assets) != 1 || list.Assets[0].ID != uploaded.ID {
		t.Fatalf("unexpected audio asset list: %+v", list)
	}
}

func TestMeetingASRJobCreateListsAndRetriesNotConfigured(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	origStorage := testHandler.Storage
	testHandler.Storage = &mockStorage{}
	defer func() { testHandler.Storage = origStorage }()

	fixture := createMeetingProjectFixture(t, "asr-job")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "会后转写任务",
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

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "asr-source.webm")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("fake webm audio bytes")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/audio-assets?workspace_id="+testWorkspaceID, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-User-ID", testUserID)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	req = withURLParam(req, "id", created.ID)
	w = httptest.NewRecorder()
	testHandler.UploadMeetingAudioAsset(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("UploadMeetingAudioAsset: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var uploaded struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(w.Body).Decode(&uploaded); err != nil {
		t.Fatalf("decode uploaded audio asset: %v", err)
	}

	req = withURLParams(
		newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/audio-assets/"+uploaded.ID+"/asr-jobs?workspace_id="+testWorkspaceID, map[string]any{
			"provider": "local",
		}),
		"id",
		created.ID,
		"assetId",
		uploaded.ID,
	)
	w = httptest.NewRecorder()
	testHandler.CreateMeetingASRJob(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingASRJob: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var job struct {
		ID           string `json:"id"`
		AudioAssetID string `json:"audio_asset_id"`
		Status       string `json:"status"`
		Provider     string `json:"provider"`
		ErrorMessage string `json:"error_message"`
		RetryCount   int32  `json:"retry_count"`
	}
	if err := json.NewDecoder(w.Body).Decode(&job); err != nil {
		t.Fatalf("decode asr job: %v", err)
	}
	if job.ID == "" || job.AudioAssetID != uploaded.ID || job.Provider != "local" {
		t.Fatalf("unexpected asr job identity: %+v", job)
	}
	if job.Status != "running" || job.ErrorMessage != "" {
		t.Fatalf("expected newly created ASR job to return running, got %+v", job)
	}
	failed := waitForMeetingASRJobStatus(t, created.ID, job.ID, "failed")
	if !strings.Contains(failed.ErrorMessage, "not configured") {
		t.Fatalf("expected not-configured failed job, got %+v", failed)
	}

	req = withURLParam(newRequest(http.MethodGet, "/api/v13/meetings/"+created.ID+"/asr-jobs?workspace_id="+testWorkspaceID, nil), "id", created.ID)
	w = httptest.NewRecorder()
	testHandler.ListMeetingASRJobs(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListMeetingASRJobs: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list struct {
		Jobs []struct {
			ID string `json:"id"`
		} `json:"jobs"`
		Total int `json:"total"`
	}
	if err := json.NewDecoder(w.Body).Decode(&list); err != nil {
		t.Fatalf("decode asr job list: %v", err)
	}
	if list.Total != 1 || len(list.Jobs) != 1 || list.Jobs[0].ID != job.ID {
		t.Fatalf("unexpected asr job list: %+v", list)
	}

	req = withURLParams(newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/asr-jobs/"+job.ID+"/retry?workspace_id="+testWorkspaceID, nil), "id", created.ID, "jobId", job.ID)
	w = httptest.NewRecorder()
	testHandler.RetryMeetingASRJob(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("RetryMeetingASRJob: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var retried struct {
		Status     string `json:"status"`
		RetryCount int32  `json:"retry_count"`
	}
	if err := json.NewDecoder(w.Body).Decode(&retried); err != nil {
		t.Fatalf("decode retried asr job: %v", err)
	}
	if retried.Status != "running" || retried.RetryCount != 1 {
		t.Fatalf("unexpected retried job: %+v", retried)
	}
	failed = waitForMeetingASRJobStatus(t, created.ID, job.ID, "failed")
	if failed.RetryCount != 1 || !strings.Contains(failed.ErrorMessage, "not configured") {
		t.Fatalf("unexpected failed retry snapshot: %+v", failed)
	}
}

func TestMeetingASRJobCreateReturnsBeforeSlowLocalCommandCompletes(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	commandPath := filepath.Join(t.TempDir(), "slow-asr")
	if err := os.WriteFile(commandPath, []byte(`#!/bin/sh
sleep 1
printf '%s' '{"segments":[{"text":"慢速命令完成后写回"}]}'
`), 0755); err != nil {
		t.Fatalf("write slow asr command: %v", err)
	}
	t.Setenv("MEETING_ASR_LOCAL_COMMAND", commandPath)
	origStorage := testHandler.Storage
	testHandler.Storage = localASRTestStorage{dir: t.TempDir()}
	defer func() { testHandler.Storage = origStorage }()

	fixture := createMeetingProjectFixture(t, "asr-slow-command")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "慢速本地转写会议",
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

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "slow-command.webm")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("fake webm audio bytes")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/audio-assets?workspace_id="+testWorkspaceID, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-User-ID", testUserID)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	req = withURLParam(req, "id", created.ID)
	w = httptest.NewRecorder()
	testHandler.UploadMeetingAudioAsset(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("UploadMeetingAudioAsset: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var uploaded struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(w.Body).Decode(&uploaded); err != nil {
		t.Fatalf("decode uploaded audio asset: %v", err)
	}

	req = withURLParams(
		newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/audio-assets/"+uploaded.ID+"/asr-jobs?workspace_id="+testWorkspaceID, map[string]any{
			"provider": "local",
		}),
		"id",
		created.ID,
		"assetId",
		uploaded.ID,
	)
	w = httptest.NewRecorder()
	startedAt := time.Now()
	testHandler.CreateMeetingASRJob(w, req)
	elapsed := time.Since(startedAt)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingASRJob: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var job struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(w.Body).Decode(&job); err != nil {
		t.Fatalf("decode asr job: %v", err)
	}
	if elapsed >= 500*time.Millisecond {
		t.Fatalf("CreateMeetingASRJob blocked on slow ASR command for %s", elapsed)
	}
	if job.Status != "running" {
		t.Fatalf("expected ASR job to return running immediately, got %+v", job)
	}

	waitForMeetingASRJobStatus(t, created.ID, job.ID, "completed")
}

func TestMeetingASRJobLocalCommandCreatesTranscriptSegments(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	commandPath := filepath.Join(t.TempDir(), "fake-asr")
	if err := os.WriteFile(commandPath, []byte(`#!/bin/sh
printf '%s' '{"segments":[{"speaker_label":"客户","text":"预算需要下周确认","start":1.25,"confidence":0.91},{"text":"我们会先补一版方案"}]}'
`), 0755); err != nil {
		t.Fatalf("write fake asr command: %v", err)
	}
	t.Setenv("MEETING_ASR_LOCAL_COMMAND", commandPath)
	origStorage := testHandler.Storage
	testHandler.Storage = localASRTestStorage{dir: t.TempDir()}
	defer func() { testHandler.Storage = origStorage }()

	fixture := createMeetingProjectFixture(t, "asr-local-command")

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/v13/meetings?workspace_id="+testWorkspaceID, map[string]any{
		"project_id":       fixture.ProjectID,
		"title":            "本地转写会议",
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

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "local-command.webm")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("fake webm audio bytes")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/audio-assets?workspace_id="+testWorkspaceID, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-User-ID", testUserID)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	req = withURLParam(req, "id", created.ID)
	w = httptest.NewRecorder()
	testHandler.UploadMeetingAudioAsset(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("UploadMeetingAudioAsset: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var uploaded struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(w.Body).Decode(&uploaded); err != nil {
		t.Fatalf("decode uploaded audio asset: %v", err)
	}

	req = withURLParams(
		newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/audio-assets/"+uploaded.ID+"/asr-jobs?workspace_id="+testWorkspaceID, map[string]any{
			"provider": "local",
		}),
		"id",
		created.ID,
		"assetId",
		uploaded.ID,
	)
	w = httptest.NewRecorder()
	testHandler.CreateMeetingASRJob(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateMeetingASRJob: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var job struct {
		ID             string `json:"id"`
		Status         string `json:"status"`
		ErrorMessage   string `json:"error_message"`
		SourceSeqStart *int32 `json:"source_seq_start"`
		SourceSeqEnd   *int32 `json:"source_seq_end"`
	}
	if err := json.NewDecoder(w.Body).Decode(&job); err != nil {
		t.Fatalf("decode asr job: %v", err)
	}
	if job.Status != "running" || job.ErrorMessage != "" {
		t.Fatalf("expected newly created ASR job to return running, got %+v", job)
	}
	completed := waitForMeetingASRJobStatus(t, created.ID, job.ID, "completed")
	if completed.SourceSeqStart == nil || *completed.SourceSeqStart != 1 || completed.SourceSeqEnd == nil || *completed.SourceSeqEnd != 2 {
		t.Fatalf("unexpected source seq range: %+v", completed)
	}

	req = withURLParam(newRequest(http.MethodGet, "/api/v13/meetings/"+created.ID+"/transcript-segments?workspace_id="+testWorkspaceID, nil), "id", created.ID)
	w = httptest.NewRecorder()
	testHandler.ListMeetingTranscriptSegments(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListMeetingTranscriptSegments: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var transcript struct {
		Segments []struct {
			Seq           int32   `json:"seq"`
			SpeakerLabel  string  `json:"speaker_label"`
			Text          string  `json:"text"`
			Source        string  `json:"source"`
			Confidence    float64 `json:"confidence"`
			AudioOffsetMs *int32  `json:"audio_offset_ms"`
		} `json:"segments"`
		Total int `json:"total"`
	}
	if err := json.NewDecoder(w.Body).Decode(&transcript); err != nil {
		t.Fatalf("decode transcript: %v", err)
	}
	if transcript.Total != 2 || len(transcript.Segments) != 2 {
		t.Fatalf("unexpected transcript total: %+v", transcript)
	}
	if transcript.Segments[0].Seq != 1 || transcript.Segments[0].SpeakerLabel != "客户" || transcript.Segments[0].Text != "预算需要下周确认" || transcript.Segments[0].Source != "local" {
		t.Fatalf("unexpected first transcript segment: %+v", transcript.Segments[0])
	}
	if transcript.Segments[0].AudioOffsetMs == nil || *transcript.Segments[0].AudioOffsetMs != 1250 {
		t.Fatalf("unexpected first audio offset: %+v", transcript.Segments[0].AudioOffsetMs)
	}
	if transcript.Segments[1].Seq != 2 || transcript.Segments[1].SpeakerLabel != "录音转写" || transcript.Segments[1].Text != "我们会先补一版方案" || transcript.Segments[1].Source != "local" {
		t.Fatalf("unexpected second transcript segment: %+v", transcript.Segments[1])
	}

	req = withURLParams(newRequest(http.MethodPost, "/api/v13/meetings/"+created.ID+"/asr-jobs/"+job.ID+"/retry?workspace_id="+testWorkspaceID, nil), "id", created.ID, "jobId", job.ID)
	w = httptest.NewRecorder()
	testHandler.RetryMeetingASRJob(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("RetryMeetingASRJob: expected 409 for completed job, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMeetingASRRunnerRecoversStaleActiveJobs(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	meeting, asset := createMeetingForASRTest(t, "stale-recovery")
	job, err := testHandler.Queries.CreateMeetingASRJob(context.Background(), db.CreateMeetingASRJobParams{
		WorkspaceID:  meeting.WorkspaceID,
		ProjectID:    meeting.ProjectID,
		MeetingID:    meeting.ID,
		AudioAssetID: asset.ID,
		Provider:     "local",
	})
	if err != nil {
		t.Fatalf("create ASR job: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `
		UPDATE meeting_asr_job
		SET status = 'running', updated_at = now() - interval '2 hours'
		WHERE id = $1
	`, job.ID); err != nil {
		t.Fatalf("make ASR job stale: %v", err)
	}

	recovered, err := testHandler.RecoverStaleMeetingASRJobs(context.Background(), time.Now().Add(-time.Minute))
	if err != nil {
		t.Fatalf("recover stale ASR jobs: %v", err)
	}
	if len(recovered) == 0 {
		t.Fatalf("expected stale ASR job to be recovered")
	}

	snapshot := waitForMeetingASRJobStatus(t, uuidToString(meeting.ID), uuidToString(job.ID), "failed")
	if !strings.Contains(snapshot.ErrorMessage, "interrupted") {
		t.Fatalf("expected interrupted recovery message, got %+v", snapshot)
	}
}

func TestMeetingASRRunnerDoesNotWriteTranscriptWhenJobNoLongerRunning(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	commandPath := filepath.Join(t.TempDir(), "fake-asr")
	if err := os.WriteFile(commandPath, []byte(`#!/bin/sh
printf '%s' '{"segments":[{"text":"不应该写入的转写"}]}'
`), 0755); err != nil {
		t.Fatalf("write fake asr command: %v", err)
	}
	t.Setenv("MEETING_ASR_LOCAL_COMMAND", commandPath)
	storageDir := t.TempDir()
	origStorage := testHandler.Storage
	testHandler.Storage = localASRTestStorage{dir: storageDir}
	defer func() { testHandler.Storage = origStorage }()
	meeting, asset := createMeetingForASRTest(t, "cancelled-guard")
	audioPath := filepath.Join(storageDir, asset.StorageKey)
	if err := os.MkdirAll(filepath.Dir(audioPath), 0755); err != nil {
		t.Fatalf("prepare audio dir: %v", err)
	}
	if err := os.WriteFile(audioPath, []byte("fake audio"), 0644); err != nil {
		t.Fatalf("write audio asset: %v", err)
	}
	job, err := testHandler.Queries.CreateMeetingASRJob(context.Background(), db.CreateMeetingASRJobParams{
		WorkspaceID:  meeting.WorkspaceID,
		ProjectID:    meeting.ProjectID,
		MeetingID:    meeting.ID,
		AudioAssetID: asset.ID,
		Provider:     "local",
	})
	if err != nil {
		t.Fatalf("create ASR job: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `
		UPDATE meeting_asr_job SET status = 'cancelled' WHERE id = $1
	`, job.ID); err != nil {
		t.Fatalf("cancel ASR job: %v", err)
	}
	job, err = testHandler.Queries.GetMeetingASRJob(context.Background(), db.GetMeetingASRJobParams{
		ID:          job.ID,
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		t.Fatalf("reload ASR job: %v", err)
	}

	if _, err := testHandler.runMeetingASRJob(context.Background(), meeting, asset, job, testUserID); err == nil {
		t.Fatalf("expected cancelled ASR job completion to be rejected")
	}
	var segmentCount int
	if err := testPool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM meeting_transcript_segment WHERE meeting_id = $1
	`, meeting.ID).Scan(&segmentCount); err != nil {
		t.Fatalf("count transcript segments: %v", err)
	}
	if segmentCount != 0 {
		t.Fatalf("expected no transcript segments for cancelled ASR job, got %d", segmentCount)
	}
	snapshot := waitForMeetingASRJobStatus(t, uuidToString(meeting.ID), uuidToString(job.ID), "cancelled")
	if snapshot.Status != "cancelled" {
		t.Fatalf("ASR job status should remain cancelled, got %+v", snapshot)
	}
}

func TestMeetingASRStatusReportsLocalCommandHealth(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	t.Run("not configured", func(t *testing.T) {
		t.Setenv("MEETING_ASR_LOCAL_COMMAND", "")
		w := httptest.NewRecorder()
		req := newRequest(http.MethodGet, "/api/v13/meetings/asr/status?workspace_id="+testWorkspaceID, nil)
		testHandler.GetMeetingASRStatus(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("GetMeetingASRStatus: expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var status struct {
			Local struct {
				Configured bool   `json:"configured"`
				Available  bool   `json:"available"`
				Error      string `json:"error"`
			} `json:"local"`
		}
		if err := json.NewDecoder(w.Body).Decode(&status); err != nil {
			t.Fatalf("decode status: %v", err)
		}
		if status.Local.Configured || status.Local.Available || !strings.Contains(status.Local.Error, "not configured") {
			t.Fatalf("unexpected unconfigured ASR status: %+v", status.Local)
		}
	})

	t.Run("configured executable", func(t *testing.T) {
		commandPath := filepath.Join(t.TempDir(), "fake-asr")
		if err := os.WriteFile(commandPath, []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
			t.Fatalf("write fake asr command: %v", err)
		}
		t.Setenv("MEETING_ASR_LOCAL_COMMAND", commandPath+" --json")
		t.Setenv("MEETING_ASR_LOCAL_TIMEOUT_SECONDS", "12")
		w := httptest.NewRecorder()
		req := newRequest(http.MethodGet, "/api/v13/meetings/asr/status?workspace_id="+testWorkspaceID, nil)
		testHandler.GetMeetingASRStatus(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("GetMeetingASRStatus: expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var status struct {
			Local struct {
				Configured  bool   `json:"configured"`
				Available   bool   `json:"available"`
				CommandName string `json:"command_name"`
				TimeoutSec  int    `json:"timeout_seconds"`
				Error       string `json:"error"`
			} `json:"local"`
		}
		if err := json.NewDecoder(w.Body).Decode(&status); err != nil {
			t.Fatalf("decode status: %v", err)
		}
		if !status.Local.Configured || !status.Local.Available || status.Local.CommandName != "fake-asr" || status.Local.TimeoutSec != 12 || status.Local.Error != "" {
			t.Fatalf("unexpected configured ASR status: %+v", status.Local)
		}
	})
}

func TestMeetingASRStatusReportsExternalProviderHealth(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	t.Run("not configured", func(t *testing.T) {
		t.Setenv("MEETING_ASR_EXTERNAL_ENDPOINT", "")
		w := httptest.NewRecorder()
		req := newRequest(http.MethodGet, "/api/v13/meetings/asr/status?workspace_id="+testWorkspaceID, nil)
		testHandler.GetMeetingASRStatus(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("GetMeetingASRStatus: expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var status struct {
			External struct {
				Configured bool   `json:"configured"`
				Available  bool   `json:"available"`
				Error      string `json:"error"`
			} `json:"external"`
		}
		if err := json.NewDecoder(w.Body).Decode(&status); err != nil {
			t.Fatalf("decode status: %v", err)
		}
		if status.External.Configured || status.External.Available || !strings.Contains(status.External.Error, "not configured") {
			t.Fatalf("unexpected unconfigured external ASR status: %+v", status.External)
		}
	})

	t.Run("configured endpoint", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}))
		defer srv.Close()
		t.Setenv("MEETING_ASR_EXTERNAL_ENDPOINT", srv.URL)
		t.Setenv("MEETING_ASR_EXTERNAL_TIMEOUT_SECONDS", "9")
		w := httptest.NewRecorder()
		req := newRequest(http.MethodGet, "/api/v13/meetings/asr/status?workspace_id="+testWorkspaceID, nil)
		testHandler.GetMeetingASRStatus(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("GetMeetingASRStatus: expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var status struct {
			External struct {
				Configured  bool   `json:"configured"`
				Available   bool   `json:"available"`
				CommandName string `json:"command_name"`
				TimeoutSec  int    `json:"timeout_seconds"`
				Error       string `json:"error"`
			} `json:"external"`
		}
		if err := json.NewDecoder(w.Body).Decode(&status); err != nil {
			t.Fatalf("decode status: %v", err)
		}
		if !status.External.Configured || !status.External.Available || status.External.CommandName != "external-asr" || status.External.TimeoutSec != 9 || status.External.Error != "" {
			t.Fatalf("unexpected configured external ASR status: %+v", status.External)
		}
	})
}

func TestMeetingASRExternalProviderCreatesTranscriptSegments(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	var sawAuth bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "Bearer test-external-key" {
			sawAuth = true
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatalf("parse external ASR multipart form: %v", err)
		}
		if _, _, err := r.FormFile("file"); err != nil {
			t.Fatalf("external ASR request missing file: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"segments":[{"speaker_label":"客户","text":"外部 ASR 已经完成","start_ms":320,"confidence":0.87}]}`))
	}))
	defer srv.Close()
	t.Setenv("MEETING_ASR_EXTERNAL_ENDPOINT", srv.URL)
	t.Setenv("MEETING_ASR_EXTERNAL_API_KEY", "test-external-key")
	t.Setenv("MEETING_ASR_EXTERNAL_TIMEOUT_SECONDS", "5")
	storageDir := t.TempDir()
	origStorage := testHandler.Storage
	testHandler.Storage = localASRTestStorage{dir: storageDir}
	defer func() { testHandler.Storage = origStorage }()
	meeting, asset := createMeetingForASRTest(t, "external-provider")
	audioPath := filepath.Join(storageDir, asset.StorageKey)
	if err := os.MkdirAll(filepath.Dir(audioPath), 0755); err != nil {
		t.Fatalf("prepare audio dir: %v", err)
	}
	if err := os.WriteFile(audioPath, []byte("fake external audio"), 0644); err != nil {
		t.Fatalf("write audio asset: %v", err)
	}
	job, err := testHandler.Queries.CreateMeetingASRJob(context.Background(), db.CreateMeetingASRJobParams{
		WorkspaceID:  meeting.WorkspaceID,
		ProjectID:    meeting.ProjectID,
		MeetingID:    meeting.ID,
		AudioAssetID: asset.ID,
		Provider:     "external",
	})
	if err != nil {
		t.Fatalf("create ASR job: %v", err)
	}

	completed, err := testHandler.runMeetingASRJob(context.Background(), meeting, asset, job, testUserID)
	if err != nil {
		t.Fatalf("run external ASR job: %v", err)
	}
	if completed.Status != "completed" || completed.SourceSeqStart.Int32 != 1 || completed.SourceSeqEnd.Int32 != 1 {
		t.Fatalf("unexpected completed external ASR job: %+v", completed)
	}
	if !sawAuth {
		t.Fatalf("external ASR request did not include configured bearer auth")
	}
	segments := listTranscriptSegmentsForTest(t, meeting, 10)
	if len(segments) != 1 || segments[0].Source != "external" || segments[0].Text != "外部 ASR 已经完成" || segments[0].AudioOffsetMs == nil || *segments[0].AudioOffsetMs != 320 {
		t.Fatalf("unexpected external ASR transcript segments: %+v", segments)
	}
}

func TestParseMeetingASRLocalCommandSupportsQuotedPath(t *testing.T) {
	parts, err := parseMeetingASRLocalCommand(`"/tmp/ASR Tools/fake whisper" --model "large v3"`)
	if err != nil {
		t.Fatalf("parse command: %v", err)
	}
	want := []string{"/tmp/ASR Tools/fake whisper", "--model", "large v3"}
	if len(parts) != len(want) {
		t.Fatalf("parts len: got %d want %d: %#v", len(parts), len(want), parts)
	}
	for i := range want {
		if parts[i] != want[i] {
			t.Fatalf("part %d: got %q want %q", i, parts[i], want[i])
		}
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
