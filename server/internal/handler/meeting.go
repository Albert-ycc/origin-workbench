package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// Meeting copilot endpoints (PRD §18).

var meetingAudioContentTypesByExt = map[string]string{
	".aac":  "audio/aac",
	".m4a":  "audio/mp4",
	".mp3":  "audio/mpeg",
	".mp4":  "audio/mp4",
	".wav":  "audio/wav",
	".webm": "audio/webm",
}

type MeetingSessionResponse struct {
	ID                string          `json:"id"`
	WorkspaceID       string          `json:"workspace_id"`
	ProjectID         string          `json:"project_id"`
	Title             string          `json:"title"`
	Goal              string          `json:"goal"`
	UserRole          string          `json:"user_role"`
	Strategy          json.RawMessage `json:"strategy"`
	ReminderMode      string          `json:"reminder_mode"`
	ReminderIntensity string          `json:"reminder_intensity"`
	SoundEnabled      bool            `json:"sound_enabled"`
	ASRProvider       string          `json:"asr_provider"`
	ModelSource       string          `json:"model_source"`
	AnalysisStatus    string          `json:"analysis_status"`
	Status            string          `json:"status"`
	CreatedByUserID   string          `json:"created_by_user_id"`
	StartedAt         *string         `json:"started_at"`
	StoppedAt         *string         `json:"stopped_at"`
	CreatedAt         string          `json:"created_at"`
	UpdatedAt         string          `json:"updated_at"`
}

type ListMeetingSessionsResponse struct {
	Meetings []MeetingSessionResponse `json:"meetings"`
	Total    int                      `json:"total"`
}

type MeetingTranscriptSegmentResponse struct {
	ID            string  `json:"id"`
	WorkspaceID   string  `json:"workspace_id"`
	ProjectID     string  `json:"project_id"`
	MeetingID     string  `json:"meeting_id"`
	Seq           int32   `json:"seq"`
	StartedAt     *string `json:"started_at"`
	EndedAt       *string `json:"ended_at"`
	SpeakerLabel  string  `json:"speaker_label"`
	Text          string  `json:"text"`
	Confidence    float64 `json:"confidence"`
	AudioOffsetMs *int32  `json:"audio_offset_ms"`
	Source        string  `json:"source"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
	DeletedAt     *string `json:"deleted_at"`
	EditRevision  int32   `json:"edit_revision"`
}

type ListMeetingTranscriptSegmentsResponse struct {
	Segments []MeetingTranscriptSegmentResponse `json:"segments"`
	Total    int                                `json:"total"`
}

type SplitMeetingTranscriptSegmentResponse struct {
	Segments []MeetingTranscriptSegmentResponse `json:"segments"`
}

type MergeMeetingTranscriptSegmentsResponse struct {
	Segment          MeetingTranscriptSegmentResponse `json:"segment"`
	DeletedSegmentID string                           `json:"deleted_segment_id"`
}

type MeetingInsightCardResponse struct {
	ID                string  `json:"id"`
	WorkspaceID       string  `json:"workspace_id"`
	ProjectID         string  `json:"project_id"`
	MeetingID         string  `json:"meeting_id"`
	Type              string  `json:"type"`
	Severity          string  `json:"severity"`
	Title             string  `json:"title"`
	Reason            string  `json:"reason"`
	SuggestedQuestion string  `json:"suggested_question"`
	EvidenceQuote     string  `json:"evidence_quote"`
	EvidenceSegmentID *string `json:"evidence_segment_id"`
	EvidenceStartMs   *int32  `json:"evidence_start_ms"`
	EvidenceEndMs     *int32  `json:"evidence_end_ms"`
	Confidence        float64 `json:"confidence"`
	Status            string  `json:"status"`
	DedupeKey         *string `json:"dedupe_key"`
	AlertedAt         *string `json:"alerted_at"`
	ResolvedAt        *string `json:"resolved_at"`
	CreatedAt         string  `json:"created_at"`
	UpdatedAt         string  `json:"updated_at"`
}

type ListMeetingInsightCardsResponse struct {
	Cards []MeetingInsightCardResponse `json:"cards"`
	Total int                          `json:"total"`
}

type MeetingSummaryResponse struct {
	MeetingID        string   `json:"meeting_id"`
	WorkspaceID      string   `json:"workspace_id"`
	ProjectID        string   `json:"project_id"`
	SummaryMd        string   `json:"summary_md"`
	Decisions        []string `json:"decisions"`
	Questions        []string `json:"questions"`
	Risks            []string `json:"risks"`
	Feedback         []string `json:"feedback"`
	Tensions         []string `json:"tensions"`
	ActionItems      []string `json:"action_items"`
	MemoryCandidates []string `json:"memory_candidates"`
	SourceSeqStart   *int32   `json:"source_seq_start"`
	SourceSeqEnd     *int32   `json:"source_seq_end"`
	GeneratedBy      string   `json:"generated_by"`
	DurationSeconds  int64    `json:"duration_seconds"`
	CreatedAt        string   `json:"created_at"`
	UpdatedAt        string   `json:"updated_at"`
}

type MeetingAudioAssetResponse struct {
	ID              string `json:"id"`
	WorkspaceID     string `json:"workspace_id"`
	ProjectID       string `json:"project_id"`
	MeetingID       string `json:"meeting_id"`
	Filename        string `json:"filename"`
	URL             string `json:"url"`
	DownloadURL     string `json:"download_url"`
	ContentType     string `json:"content_type"`
	SizeBytes       int64  `json:"size_bytes"`
	DurationSeconds *int32 `json:"duration_seconds"`
	Status          string `json:"status"`
	CreatedByUserID string `json:"created_by_user_id"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

type ListMeetingAudioAssetsResponse struct {
	Assets []MeetingAudioAssetResponse `json:"assets"`
	Total  int                         `json:"total"`
}

type MeetingASRJobResponse struct {
	ID             string `json:"id"`
	WorkspaceID    string `json:"workspace_id"`
	ProjectID      string `json:"project_id"`
	MeetingID      string `json:"meeting_id"`
	AudioAssetID   string `json:"audio_asset_id"`
	Provider       string `json:"provider"`
	Status         string `json:"status"`
	ErrorMessage   string `json:"error_message"`
	RetryCount     int32  `json:"retry_count"`
	SourceSeqStart *int32 `json:"source_seq_start"`
	SourceSeqEnd   *int32 `json:"source_seq_end"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

type ListMeetingASRJobsResponse struct {
	Jobs  []MeetingASRJobResponse `json:"jobs"`
	Total int                     `json:"total"`
}

type CreateMeetingSessionRequest struct {
	ProjectID         string          `json:"project_id"`
	Title             string          `json:"title"`
	Goal              string          `json:"goal"`
	UserRole          string          `json:"user_role"`
	Strategy          json.RawMessage `json:"strategy"`
	ReminderMode      string          `json:"reminder_mode"`
	ReminderIntensity string          `json:"reminder_intensity"`
	SoundEnabled      bool            `json:"sound_enabled"`
	ASRProvider       string          `json:"asr_provider"`
	ModelSource       string          `json:"model_source"`
	AnalysisEnabled   bool            `json:"analysis_enabled"`
}

type UpdateMeetingSessionRequest struct {
	Title             *string         `json:"title"`
	Goal              *string         `json:"goal"`
	UserRole          *string         `json:"user_role"`
	Strategy          json.RawMessage `json:"strategy"`
	ReminderMode      *string         `json:"reminder_mode"`
	ReminderIntensity *string         `json:"reminder_intensity"`
	SoundEnabled      *bool           `json:"sound_enabled"`
	ASRProvider       *string         `json:"asr_provider"`
	ModelSource       *string         `json:"model_source"`
	AnalysisEnabled   *bool           `json:"analysis_enabled"`
}

type CreateMeetingTranscriptSegmentRequest struct {
	Seq           int32   `json:"seq"`
	SpeakerLabel  string  `json:"speaker_label"`
	Text          string  `json:"text"`
	Confidence    float64 `json:"confidence"`
	Source        string  `json:"source"`
	AudioOffsetMs *int32  `json:"audio_offset_ms"`
}

type UpdateMeetingTranscriptSegmentRequest struct {
	SpeakerLabel  *string  `json:"speaker_label"`
	Text          *string  `json:"text"`
	Confidence    *float64 `json:"confidence"`
	AudioOffsetMs *int32   `json:"audio_offset_ms"`
}

type SplitMeetingTranscriptSegmentRequest struct {
	TextBefore        string `json:"text_before"`
	TextAfter         string `json:"text_after"`
	SpeakerLabelAfter string `json:"speaker_label_after"`
}

type MergeMeetingTranscriptSegmentsRequest struct {
	TargetSegmentID string `json:"target_segment_id"`
}

type CreateMeetingASRJobRequest struct {
	Provider string `json:"provider"`
}

type UpdateMeetingInsightStatusRequest struct {
	Status string `json:"status"`
}

func meetingSessionToResponse(m db.MeetingSession) MeetingSessionResponse {
	strategy := json.RawMessage(m.Strategy)
	if len(strategy) == 0 {
		strategy = json.RawMessage(`{}`)
	}
	return MeetingSessionResponse{
		ID:                uuidToString(m.ID),
		WorkspaceID:       uuidToString(m.WorkspaceID),
		ProjectID:         uuidToString(m.ProjectID),
		Title:             m.Title,
		Goal:              m.Goal,
		UserRole:          m.UserRole,
		Strategy:          strategy,
		ReminderMode:      m.ReminderMode,
		ReminderIntensity: m.ReminderIntensity,
		SoundEnabled:      m.SoundEnabled,
		ASRProvider:       m.AsrProvider,
		ModelSource:       m.ModelSource,
		AnalysisStatus:    m.AnalysisStatus,
		Status:            m.Status,
		CreatedByUserID:   uuidToString(m.CreatedByUserID),
		StartedAt:         timestampToPtr(m.StartedAt),
		StoppedAt:         timestampToPtr(m.StoppedAt),
		CreatedAt:         timestampToString(m.CreatedAt),
		UpdatedAt:         timestampToString(m.UpdatedAt),
	}
}

func meetingTranscriptSegmentToResponse(s db.MeetingTranscriptSegment) MeetingTranscriptSegmentResponse {
	return MeetingTranscriptSegmentResponse{
		ID:            uuidToString(s.ID),
		WorkspaceID:   uuidToString(s.WorkspaceID),
		ProjectID:     uuidToString(s.ProjectID),
		MeetingID:     uuidToString(s.MeetingID),
		Seq:           s.Seq,
		StartedAt:     timestampToPtr(s.StartedAt),
		EndedAt:       timestampToPtr(s.EndedAt),
		SpeakerLabel:  s.SpeakerLabel,
		Text:          s.Text,
		Confidence:    s.Confidence,
		AudioOffsetMs: int4ToPtr(s.AudioOffsetMs),
		Source:        s.Source,
		CreatedAt:     timestampToString(s.CreatedAt),
		UpdatedAt:     timestampToString(s.UpdatedAt),
		DeletedAt:     timestampToPtr(s.DeletedAt),
		EditRevision:  s.EditRevision,
	}
}

func meetingInsightCardToResponse(c db.MeetingInsightCard) MeetingInsightCardResponse {
	return MeetingInsightCardResponse{
		ID:                uuidToString(c.ID),
		WorkspaceID:       uuidToString(c.WorkspaceID),
		ProjectID:         uuidToString(c.ProjectID),
		MeetingID:         uuidToString(c.MeetingID),
		Type:              c.Type,
		Severity:          c.Severity,
		Title:             c.Title,
		Reason:            c.Reason,
		SuggestedQuestion: c.SuggestedQuestion,
		EvidenceQuote:     c.EvidenceQuote,
		EvidenceSegmentID: uuidToPtr(c.EvidenceSegmentID),
		EvidenceStartMs:   int4ToPtr(c.EvidenceStartMs),
		EvidenceEndMs:     int4ToPtr(c.EvidenceEndMs),
		Confidence:        c.Confidence,
		Status:            c.Status,
		DedupeKey:         textToPtr(c.DedupeKey),
		AlertedAt:         timestampToPtr(c.AlertedAt),
		ResolvedAt:        timestampToPtr(c.ResolvedAt),
		CreatedAt:         timestampToString(c.CreatedAt),
		UpdatedAt:         timestampToString(c.UpdatedAt),
	}
}

func (h *Handler) meetingAudioAssetToResponse(a db.MeetingAudioAsset) MeetingAudioAssetResponse {
	resp := MeetingAudioAssetResponse{
		ID:              uuidToString(a.ID),
		WorkspaceID:     uuidToString(a.WorkspaceID),
		ProjectID:       uuidToString(a.ProjectID),
		MeetingID:       uuidToString(a.MeetingID),
		Filename:        a.Filename,
		URL:             a.FileUrl,
		DownloadURL:     a.FileUrl,
		ContentType:     a.ContentType,
		SizeBytes:       a.SizeBytes,
		Status:          a.Status,
		CreatedByUserID: uuidToString(a.CreatedByUserID),
		CreatedAt:       timestampToString(a.CreatedAt),
		UpdatedAt:       timestampToString(a.UpdatedAt),
	}
	if a.DurationSeconds.Valid {
		resp.DurationSeconds = &a.DurationSeconds.Int32
	}
	if h.CFSigner != nil {
		resp.DownloadURL = h.CFSigner.SignedURL(a.FileUrl, time.Now().Add(30*time.Minute))
	}
	return resp
}

func meetingASRJobToResponse(j db.MeetingAsrJob) MeetingASRJobResponse {
	return MeetingASRJobResponse{
		ID:             uuidToString(j.ID),
		WorkspaceID:    uuidToString(j.WorkspaceID),
		ProjectID:      uuidToString(j.ProjectID),
		MeetingID:      uuidToString(j.MeetingID),
		AudioAssetID:   uuidToString(j.AudioAssetID),
		Provider:       j.Provider,
		Status:         j.Status,
		ErrorMessage:   j.ErrorMessage,
		RetryCount:     j.RetryCount,
		SourceSeqStart: int4ToPtr(j.SourceSeqStart),
		SourceSeqEnd:   int4ToPtr(j.SourceSeqEnd),
		CreatedAt:      timestampToString(j.CreatedAt),
		UpdatedAt:      timestampToString(j.UpdatedAt),
	}
}

func (h *Handler) publishMeetingASRJobUpdated(meeting db.MeetingSession, job db.MeetingAsrJob, actorID string) {
	resp := meetingASRJobToResponse(job)
	h.publish(protocol.EventMeetingASRJobUpdated, resp.WorkspaceID, "member", actorID, map[string]any{
		"meeting_id": resp.MeetingID,
		"job":        resp,
	})
}

func (h *Handler) publishMeetingTranscriptSegmentUpdated(meeting db.MeetingSession, segment db.MeetingTranscriptSegment, actorID string) {
	resp := meetingTranscriptSegmentToResponse(segment)
	h.publish(protocol.EventMeetingTranscriptSegmentUpdated, resp.WorkspaceID, "member", actorID, map[string]any{
		"meeting_id": resp.MeetingID,
		"segment":    resp,
	})
}

func (h *Handler) publishMeetingTranscriptSegmentDeleted(meeting db.MeetingSession, segment db.MeetingTranscriptSegment, actorID string) {
	h.publish(protocol.EventMeetingTranscriptSegmentDeleted, uuidToString(meeting.WorkspaceID), "member", actorID, map[string]any{
		"meeting_id": uuidToString(meeting.ID),
		"segment_id": uuidToString(segment.ID),
		"seq":        segment.Seq,
	})
}

func meetingSummaryToResponse(s db.MeetingSummary, meeting db.MeetingSession) MeetingSummaryResponse {
	durationSeconds := int64(0)
	if meeting.StartedAt.Valid && meeting.StoppedAt.Valid {
		duration := meeting.StoppedAt.Time.Sub(meeting.StartedAt.Time)
		if duration > 0 {
			durationSeconds = int64(duration.Seconds())
		}
	}
	return MeetingSummaryResponse{
		MeetingID:        uuidToString(s.MeetingID),
		WorkspaceID:      uuidToString(s.WorkspaceID),
		ProjectID:        uuidToString(s.ProjectID),
		SummaryMd:        s.SummaryMd,
		Decisions:        meetingJSONStringList(s.Decisions),
		Questions:        meetingJSONStringList(s.Questions),
		Risks:            meetingJSONStringList(s.Risks),
		Feedback:         meetingJSONStringList(s.Feedback),
		Tensions:         meetingJSONStringList(s.Tensions),
		ActionItems:      meetingJSONStringList(s.ActionItems),
		MemoryCandidates: meetingJSONStringList(s.MemoryCandidates),
		SourceSeqStart:   int4ToPtr(s.SourceSeqStart),
		SourceSeqEnd:     int4ToPtr(s.SourceSeqEnd),
		GeneratedBy:      s.GeneratedBy,
		DurationSeconds:  durationSeconds,
		CreatedAt:        timestampToString(s.CreatedAt),
		UpdatedAt:        timestampToString(s.UpdatedAt),
	}
}

func int4ToPtr(v pgtype.Int4) *int32 {
	if !v.Valid {
		return nil
	}
	return &v.Int32
}

func normalizeMeetingJSON(raw json.RawMessage) ([]byte, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []byte(`{}`), nil
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, err
	}
	return raw, nil
}

func normalizeMeetingChoice(raw, fallback string, allowed map[string]bool) (string, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		value = fallback
	}
	return value, allowed[value]
}

func meetingAnalysisConfig(enabled bool, modelSource string) (string, string, bool) {
	source, ok := normalizeMeetingChoice(modelSource, "not_configured", map[string]bool{
		"not_configured": true,
		"local":          true,
		"external":       true,
	})
	if !ok {
		return "", "", false
	}
	if enabled && source != "not_configured" {
		return source, "idle", true
	}
	return source, "paused", true
}

func meetingJSONStringList(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return []string{}
	}
	return cleanMeetingStringList(values)
}

func meetingJSONList(values []string) []byte {
	payload, err := json.Marshal(cleanMeetingStringList(values))
	if err != nil {
		return []byte(`[]`)
	}
	return payload
}

func cleanMeetingStringList(values []string) []string {
	cleaned := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		item := strings.TrimSpace(value)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		cleaned = append(cleaned, item)
	}
	return cleaned
}

func (h *Handler) ListMeetingSessions(w http.ResponseWriter, r *http.Request) {
	wsUUID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace id")
	if !ok {
		return
	}

	var rows []db.MeetingSession
	var err error
	if rawProjectID := strings.TrimSpace(r.URL.Query().Get("project_id")); rawProjectID != "" {
		projectID, ok := parseUUIDOrBadRequest(w, rawProjectID, "project_id")
		if !ok {
			return
		}
		if _, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
			ID:          projectID,
			WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "project_id not found in this workspace")
			return
		}
		rows, err = h.Queries.ListProjectMeetingSessions(r.Context(), db.ListProjectMeetingSessionsParams{
			WorkspaceID: wsUUID,
			ProjectID:   projectID,
		})
	} else {
		rows, err = h.Queries.ListMeetingSessions(r.Context(), wsUUID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list meetings")
		return
	}

	meetings := make([]MeetingSessionResponse, len(rows))
	for i, row := range rows {
		meetings[i] = meetingSessionToResponse(row)
	}
	writeJSON(w, http.StatusOK, ListMeetingSessionsResponse{Meetings: meetings, Total: len(meetings)})
}

func (h *Handler) GetMeetingSession(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, meetingSessionToResponse(meeting))
}

func (h *Handler) CreateMeetingSession(w http.ResponseWriter, r *http.Request) {
	var req CreateMeetingSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.ProjectID) == "" {
		writeError(w, http.StatusBadRequest, "project_id is required")
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace id")
	if !ok {
		return
	}
	projectID, ok := parseUUIDOrBadRequest(w, req.ProjectID, "project_id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetProjectInWorkspaceV12(r.Context(), db.GetProjectInWorkspaceV12Params{
		ID:          projectID,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusBadRequest, "project_id not found in this workspace")
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
	strategy, err := normalizeMeetingJSON(req.Strategy)
	if err != nil {
		writeError(w, http.StatusBadRequest, "strategy must be a JSON object")
		return
	}
	reminderMode, ok := normalizeMeetingChoice(req.ReminderMode, "strong", map[string]bool{
		"strong": true,
		"review": true,
		"quiet":  true,
	})
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid reminder_mode")
		return
	}
	reminderIntensity, ok := normalizeMeetingChoice(req.ReminderIntensity, "standard", map[string]bool{
		"conservative": true,
		"standard":     true,
		"aggressive":   true,
	})
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid reminder_intensity")
		return
	}
	asrProvider, ok := normalizeMeetingChoice(req.ASRProvider, "renderer", map[string]bool{
		"renderer": true,
		"local":    true,
		"external": true,
		"manual":   true,
	})
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid asr_provider")
		return
	}
	modelSource, analysisStatus, ok := meetingAnalysisConfig(req.AnalysisEnabled, req.ModelSource)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid model_source")
		return
	}

	meeting, err := h.Queries.CreateMeetingSession(r.Context(), db.CreateMeetingSessionParams{
		WorkspaceID:       wsUUID,
		ProjectID:         projectID,
		Title:             strings.TrimSpace(req.Title),
		Goal:              strings.TrimSpace(req.Goal),
		UserRole:          strings.TrimSpace(req.UserRole),
		Strategy:          strategy,
		ReminderMode:      reminderMode,
		ReminderIntensity: reminderIntensity,
		SoundEnabled:      req.SoundEnabled,
		AsrProvider:       asrProvider,
		ModelSource:       modelSource,
		AnalysisStatus:    analysisStatus,
		CreatedByUserID:   userUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create meeting")
		return
	}
	resp := meetingSessionToResponse(meeting)
	h.publish(protocol.EventMeetingCreated, resp.WorkspaceID, "member", userID, map[string]any{"meeting": resp})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) UpdateMeetingSession(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	var req UpdateMeetingSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateMeetingSessionParams{
		ID:          meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
	}
	if req.Title != nil {
		params.Title = pgtype.Text{String: strings.TrimSpace(*req.Title), Valid: true}
	}
	if req.Goal != nil {
		params.Goal = pgtype.Text{String: strings.TrimSpace(*req.Goal), Valid: true}
	}
	if req.UserRole != nil {
		params.UserRole = pgtype.Text{String: strings.TrimSpace(*req.UserRole), Valid: true}
	}
	if len(req.Strategy) > 0 {
		strategy, err := normalizeMeetingJSON(req.Strategy)
		if err != nil {
			writeError(w, http.StatusBadRequest, "strategy must be a JSON object")
			return
		}
		params.Strategy = strategy
	}
	if req.ReminderMode != nil {
		value, ok := normalizeMeetingChoice(*req.ReminderMode, "", map[string]bool{
			"strong": true,
			"review": true,
			"quiet":  true,
		})
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid reminder_mode")
			return
		}
		params.ReminderMode = pgtype.Text{String: value, Valid: true}
	}
	if req.ReminderIntensity != nil {
		value, ok := normalizeMeetingChoice(*req.ReminderIntensity, "", map[string]bool{
			"conservative": true,
			"standard":     true,
			"aggressive":   true,
		})
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid reminder_intensity")
			return
		}
		params.ReminderIntensity = pgtype.Text{String: value, Valid: true}
	}
	if req.SoundEnabled != nil {
		params.SoundEnabled = pgtype.Bool{Bool: *req.SoundEnabled, Valid: true}
	}
	if req.ASRProvider != nil {
		value, ok := normalizeMeetingChoice(*req.ASRProvider, "", map[string]bool{
			"renderer": true,
			"local":    true,
			"external": true,
			"manual":   true,
		})
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid asr_provider")
			return
		}
		params.AsrProvider = pgtype.Text{String: value, Valid: true}
	}
	if req.ModelSource != nil || req.AnalysisEnabled != nil {
		modelSource := meeting.ModelSource
		if req.ModelSource != nil {
			modelSource = *req.ModelSource
		}
		enabled := meeting.AnalysisStatus == "idle" || meeting.AnalysisStatus == "running"
		if req.AnalysisEnabled != nil {
			enabled = *req.AnalysisEnabled
		}
		source, status, ok := meetingAnalysisConfig(enabled, modelSource)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid model_source")
			return
		}
		params.ModelSource = pgtype.Text{String: source, Valid: true}
		params.AnalysisStatus = pgtype.Text{String: status, Valid: true}
	}

	updated, err := h.Queries.UpdateMeetingSession(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update meeting")
		return
	}
	resp := meetingSessionToResponse(updated)
	h.publish(protocol.EventMeetingUpdated, resp.WorkspaceID, "member", requestUserID(r), map[string]any{"meeting": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) StartMeetingSession(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	started, err := h.Queries.StartMeetingSession(r.Context(), db.StartMeetingSessionParams{
		ID:          meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start meeting")
		return
	}
	resp := meetingSessionToResponse(started)
	h.publish(protocol.EventMeetingStarted, resp.WorkspaceID, "member", requestUserID(r), map[string]any{"meeting": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) StopMeetingSession(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	stopped, err := h.Queries.StopMeetingSession(r.Context(), db.StopMeetingSessionParams{
		ID:          meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stop meeting")
		return
	}
	resp := meetingSessionToResponse(stopped)
	h.publish(protocol.EventMeetingStopped, resp.WorkspaceID, "member", requestUserID(r), map[string]any{"meeting": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ArchiveMeetingSession(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	archived, err := h.Queries.ArchiveMeetingSession(r.Context(), db.ArchiveMeetingSessionParams{
		ID:          meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive meeting")
		return
	}
	resp := meetingSessionToResponse(archived)
	h.publish(protocol.EventMeetingUpdated, resp.WorkspaceID, "member", requestUserID(r), map[string]any{"meeting": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteMeetingSession(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	if err := h.Queries.DeleteMeetingSession(r.Context(), db.DeleteMeetingSessionParams{
		ID:          meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete meeting")
		return
	}
	h.publish(protocol.EventMeetingDeleted, uuidToString(meeting.WorkspaceID), "member", requestUserID(r), map[string]any{
		"meeting_id": uuidToString(meeting.ID),
		"project_id": uuidToString(meeting.ProjectID),
	})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetMeetingSummary(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	summary, err := h.Queries.GetMeetingSummary(r.Context(), db.GetMeetingSummaryParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
	})
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "meeting summary not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get meeting summary")
		return
	}
	writeJSON(w, http.StatusOK, meetingSummaryToResponse(summary, meeting))
}

func (h *Handler) GenerateMeetingSummary(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	segments, err := h.listAllMeetingTranscriptSegments(r.Context(), meeting)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list transcript segments")
		return
	}
	if len(segments) == 0 {
		writeError(w, http.StatusBadRequest, "transcript is required before summary")
		return
	}
	cards, err := h.Queries.ListMeetingInsightCards(r.Context(), db.ListMeetingInsightCardsParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list insight cards")
		return
	}
	draft := buildMeetingSummaryDraft(meeting, segments, cards)
	chunks := buildMeetingSummaryChunks(meeting, segments)
	if len(chunks) > 1 {
		draft.SummaryMd = appendMeetingSummaryChunkIndex(draft.SummaryMd, chunks)
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate meeting summary")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)
	if err := qtx.DeleteMeetingSummaryChunks(r.Context(), db.DeleteMeetingSummaryChunksParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate meeting summary")
		return
	}
	for i, chunk := range chunks {
		_, err := qtx.CreateMeetingSummaryChunk(r.Context(), db.CreateMeetingSummaryChunkParams{
			WorkspaceID:      meeting.WorkspaceID,
			ProjectID:        meeting.ProjectID,
			MeetingID:        meeting.ID,
			ChunkIndex:       int32(i + 1),
			SourceSeqStart:   chunk.SourceSeqStart,
			SourceSeqEnd:     chunk.SourceSeqEnd,
			SummaryMd:        chunk.Draft.SummaryMd,
			Decisions:        meetingJSONList(chunk.Draft.Decisions),
			Questions:        meetingJSONList(chunk.Draft.Questions),
			Risks:            meetingJSONList(chunk.Draft.Risks),
			Feedback:         meetingJSONList(chunk.Draft.Feedback),
			Tensions:         meetingJSONList(chunk.Draft.Tensions),
			ActionItems:      meetingJSONList(chunk.Draft.ActionItems),
			MemoryCandidates: meetingJSONList(chunk.Draft.MemoryCandidates),
			GeneratedBy:      "origin-rule-summarizer",
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to generate meeting summary")
			return
		}
	}
	summary, err := qtx.UpsertMeetingSummary(r.Context(), db.UpsertMeetingSummaryParams{
		MeetingID:        meeting.ID,
		WorkspaceID:      meeting.WorkspaceID,
		ProjectID:        meeting.ProjectID,
		SummaryMd:        draft.SummaryMd,
		Decisions:        meetingJSONList(draft.Decisions),
		Questions:        meetingJSONList(draft.Questions),
		Risks:            meetingJSONList(draft.Risks),
		Feedback:         meetingJSONList(draft.Feedback),
		Tensions:         meetingJSONList(draft.Tensions),
		ActionItems:      meetingJSONList(draft.ActionItems),
		MemoryCandidates: meetingJSONList(draft.MemoryCandidates),
		SourceSeqStart:   pgtype.Int4{Int32: segments[0].Seq, Valid: true},
		SourceSeqEnd:     pgtype.Int4{Int32: segments[len(segments)-1].Seq, Valid: true},
		GeneratedBy:      "origin-rule-summarizer",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate meeting summary")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate meeting summary")
		return
	}
	resp := meetingSummaryToResponse(summary, meeting)
	h.publish(protocol.EventMeetingSummaryCreated, resp.WorkspaceID, "system", "", map[string]any{
		"meeting_id": resp.MeetingID,
		"summary":    resp,
	})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) listAllMeetingTranscriptSegments(ctx context.Context, meeting db.MeetingSession) ([]db.MeetingTranscriptSegment, error) {
	const pageLimit int32 = 1000
	afterSeq := int32(0)
	var all []db.MeetingTranscriptSegment
	for {
		page, err := h.Queries.ListMeetingTranscriptSegments(ctx, db.ListMeetingTranscriptSegmentsParams{
			MeetingID:   meeting.ID,
			WorkspaceID: meeting.WorkspaceID,
			Seq:         afterSeq,
			Limit:       pageLimit,
		})
		if err != nil {
			return nil, err
		}
		if len(page) == 0 {
			return all, nil
		}
		all = append(all, page...)
		afterSeq = page[len(page)-1].Seq
		if len(page) < int(pageLimit) {
			return all, nil
		}
	}
}

func (h *Handler) UploadMeetingAudioAsset(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		writeError(w, http.StatusServiceUnavailable, "file upload not configured")
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "file too large or invalid multipart form")
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("missing file field: %v", err))
		return
	}
	defer file.Close()

	ext := strings.ToLower(path.Ext(header.Filename))
	contentType := meetingAudioContentTypesByExt[ext]
	if contentType == "" {
		writeError(w, http.StatusBadRequest, "unsupported audio file type")
		return
	}

	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read file")
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "audio file is empty")
		return
	}

	var duration pgtype.Int4
	if raw := strings.TrimSpace(r.FormValue("duration_seconds")); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || v < 0 {
			writeError(w, http.StatusBadRequest, "invalid duration_seconds")
			return
		}
		duration = pgtype.Int4{Int32: int32(v), Valid: true}
	}

	id, err := uuid.NewV7()
	if err != nil {
		slog.Error("failed to generate meeting audio asset uuid", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	storageKey := "workspaces/" + uuidToString(meeting.WorkspaceID) + "/meetings/" + uuidToString(meeting.ID) + "/audio-assets/" + id.String() + ext
	link, err := h.Storage.Upload(r.Context(), storageKey, data, contentType, header.Filename)
	if err != nil {
		slog.Error("meeting audio upload failed", "error", err)
		writeError(w, http.StatusInternalServerError, "upload failed")
		return
	}

	asset, err := h.Queries.CreateMeetingAudioAsset(r.Context(), db.CreateMeetingAudioAssetParams{
		ID:              pgtype.UUID{Bytes: id, Valid: true},
		WorkspaceID:     meeting.WorkspaceID,
		ProjectID:       meeting.ProjectID,
		MeetingID:       meeting.ID,
		StorageKey:      storageKey,
		FileUrl:         link,
		Filename:        header.Filename,
		ContentType:     contentType,
		SizeBytes:       int64(len(data)),
		DurationSeconds: duration,
		CreatedByUserID: parseUUID(userID),
	})
	if err != nil {
		slog.Error("failed to create meeting audio asset record", "error", err)
		h.Storage.Delete(r.Context(), storageKey)
		writeError(w, http.StatusInternalServerError, "failed to create meeting audio asset")
		return
	}

	writeJSON(w, http.StatusCreated, h.meetingAudioAssetToResponse(asset))
}

func (h *Handler) ListMeetingAudioAssets(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	rows, err := h.Queries.ListMeetingAudioAssets(r.Context(), db.ListMeetingAudioAssetsParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list meeting audio assets")
		return
	}
	assets := make([]MeetingAudioAssetResponse, len(rows))
	for i, row := range rows {
		assets[i] = h.meetingAudioAssetToResponse(row)
	}
	writeJSON(w, http.StatusOK, ListMeetingAudioAssetsResponse{Assets: assets, Total: len(assets)})
}

func (h *Handler) DeleteMeetingAudioAsset(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	assetID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "assetId"), "audio asset id")
	if !ok {
		return
	}
	asset, err := h.Queries.MarkMeetingAudioAssetDeleted(r.Context(), db.MarkMeetingAudioAssetDeletedParams{
		ID:          assetID,
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "meeting audio asset not found")
		return
	}
	if h.Storage != nil {
		h.Storage.Delete(r.Context(), asset.StorageKey)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) CreateMeetingASRJob(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	assetID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "assetId"), "audio asset id")
	if !ok {
		return
	}
	var req CreateMeetingASRJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	provider, ok := normalizeMeetingChoice(req.Provider, "local", map[string]bool{
		"local":    true,
		"external": true,
		"noop":     true,
	})
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid provider")
		return
	}
	asset, err := h.Queries.GetMeetingAudioAsset(r.Context(), db.GetMeetingAudioAssetParams{
		ID:          assetID,
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil || asset.Status == "deleted" {
		writeError(w, http.StatusNotFound, "meeting audio asset not found")
		return
	}
	job, err := h.Queries.CreateMeetingASRJob(r.Context(), db.CreateMeetingASRJobParams{
		WorkspaceID:  meeting.WorkspaceID,
		ProjectID:    meeting.ProjectID,
		MeetingID:    meeting.ID,
		AudioAssetID: asset.ID,
		Provider:     provider,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create meeting asr job")
		return
	}
	h.startMeetingASRJob(meeting, asset, job, requestUserID(r))
	writeJSON(w, http.StatusCreated, meetingASRJobToResponse(job))
}

func (h *Handler) ListMeetingASRJobs(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	rows, err := h.Queries.ListMeetingASRJobs(r.Context(), db.ListMeetingASRJobsParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list meeting asr jobs")
		return
	}
	jobs := make([]MeetingASRJobResponse, len(rows))
	for i, row := range rows {
		jobs[i] = meetingASRJobToResponse(row)
	}
	writeJSON(w, http.StatusOK, ListMeetingASRJobsResponse{Jobs: jobs, Total: len(jobs)})
}

func (h *Handler) RetryMeetingASRJob(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	jobID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "jobId"), "asr job id")
	if !ok {
		return
	}
	existingJob, err := h.Queries.GetMeetingASRJob(r.Context(), db.GetMeetingASRJobParams{
		ID:          jobID,
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "meeting asr job not found")
		return
	}
	if existingJob.Status != "failed" {
		writeError(w, http.StatusConflict, "meeting asr job cannot be retried")
		return
	}
	asset, err := h.Queries.GetMeetingAudioAsset(r.Context(), db.GetMeetingAudioAssetParams{
		ID:          existingJob.AudioAssetID,
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil || asset.Status == "deleted" {
		writeError(w, http.StatusNotFound, "meeting audio asset not found")
		return
	}
	job, err := h.Queries.MarkMeetingASRJobRunningForRetry(r.Context(), db.MarkMeetingASRJobRunningForRetryParams{
		ID:          jobID,
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusConflict, "meeting asr job cannot be retried")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to retry meeting asr job")
		return
	}
	h.startMeetingASRJob(meeting, asset, job, requestUserID(r))
	writeJSON(w, http.StatusOK, meetingASRJobToResponse(job))
}

func (h *Handler) CreateMeetingTranscriptSegment(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	var req CreateMeetingTranscriptSegmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		writeError(w, http.StatusBadRequest, "text is required")
		return
	}
	source, ok := normalizeMeetingChoice(req.Source, "renderer", map[string]bool{
		"renderer": true,
		"local":    true,
		"external": true,
		"manual":   true,
	})
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid source")
		return
	}
	var offset pgtype.Int4
	if req.AudioOffsetMs != nil {
		offset = pgtype.Int4{Int32: *req.AudioOffsetMs, Valid: true}
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create transcript segment")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	if _, err := qtx.LockMeetingTranscriptSequence(r.Context(), db.LockMeetingTranscriptSequenceParams{
		ID:          meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	}); err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "meeting not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create transcript segment")
		return
	}

	seq := req.Seq
	if seq <= 0 {
		seq, err = qtx.NextMeetingTranscriptSeq(r.Context(), db.NextMeetingTranscriptSeqParams{
			MeetingID:   meeting.ID,
			WorkspaceID: meeting.WorkspaceID,
			ProjectID:   meeting.ProjectID,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create transcript segment")
			return
		}
	}

	segment, err := qtx.CreateMeetingTranscriptSegment(r.Context(), db.CreateMeetingTranscriptSegmentParams{
		WorkspaceID:   meeting.WorkspaceID,
		ProjectID:     meeting.ProjectID,
		MeetingID:     meeting.ID,
		Seq:           seq,
		SpeakerLabel:  strings.TrimSpace(req.SpeakerLabel),
		Text:          strings.TrimSpace(req.Text),
		Confidence:    req.Confidence,
		Source:        source,
		AudioOffsetMs: offset,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "transcript seq already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create transcript segment")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create transcript segment")
		return
	}

	resp := meetingTranscriptSegmentToResponse(segment)
	h.publish(protocol.EventMeetingTranscriptSegmentCreated, resp.WorkspaceID, "member", requestUserID(r), map[string]any{
		"meeting_id": resp.MeetingID,
		"segment":    resp,
	})
	h.createMeetingQuickInsight(r.Context(), meeting, segment)
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) UpdateMeetingTranscriptSegment(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	segmentID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "segmentId"), "transcript segment id")
	if !ok {
		return
	}
	existing, err := h.Queries.GetMeetingTranscriptSegment(r.Context(), db.GetMeetingTranscriptSegmentParams{
		ID:          segmentID,
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "transcript segment not found")
		return
	}
	var req UpdateMeetingTranscriptSegmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	text := existing.Text
	if req.Text != nil {
		text = strings.TrimSpace(*req.Text)
	}
	if text == "" {
		writeError(w, http.StatusBadRequest, "text is required")
		return
	}
	speaker := existing.SpeakerLabel
	if req.SpeakerLabel != nil {
		speaker = strings.TrimSpace(*req.SpeakerLabel)
	}
	confidence := existing.Confidence
	if req.Confidence != nil {
		confidence = *req.Confidence
	}
	offset := existing.AudioOffsetMs
	if req.AudioOffsetMs != nil {
		offset = pgtype.Int4{Int32: *req.AudioOffsetMs, Valid: true}
	}
	updated, err := h.Queries.UpdateMeetingTranscriptSegment(r.Context(), db.UpdateMeetingTranscriptSegmentParams{
		ID:            segmentID,
		MeetingID:     meeting.ID,
		WorkspaceID:   meeting.WorkspaceID,
		ProjectID:     meeting.ProjectID,
		SpeakerLabel:  speaker,
		Text:          text,
		Confidence:    confidence,
		AudioOffsetMs: offset,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update transcript segment")
		return
	}
	h.publishMeetingTranscriptSegmentUpdated(meeting, updated, requestUserID(r))
	writeJSON(w, http.StatusOK, meetingTranscriptSegmentToResponse(updated))
}

func (h *Handler) DeleteMeetingTranscriptSegment(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	segmentID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "segmentId"), "transcript segment id")
	if !ok {
		return
	}
	userID, ok := parseUUIDOrBadRequest(w, requestUserID(r), "user id")
	if !ok {
		return
	}
	deleted, err := h.Queries.SoftDeleteMeetingTranscriptSegment(r.Context(), db.SoftDeleteMeetingTranscriptSegmentParams{
		ID:              segmentID,
		MeetingID:       meeting.ID,
		WorkspaceID:     meeting.WorkspaceID,
		ProjectID:       meeting.ProjectID,
		DeletedByUserID: userID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "transcript segment not found")
		return
	}
	h.publishMeetingTranscriptSegmentDeleted(meeting, deleted, requestUserID(r))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) SplitMeetingTranscriptSegment(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	segmentID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "segmentId"), "transcript segment id")
	if !ok {
		return
	}
	var req SplitMeetingTranscriptSegmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	before := strings.TrimSpace(req.TextBefore)
	after := strings.TrimSpace(req.TextAfter)
	if before == "" || after == "" {
		writeError(w, http.StatusBadRequest, "split text_before and text_after are required")
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to split transcript segment")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	if _, err := qtx.LockMeetingTranscriptSequence(r.Context(), db.LockMeetingTranscriptSequenceParams{
		ID:          meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to split transcript segment")
		return
	}
	original, err := qtx.GetMeetingTranscriptSegment(r.Context(), db.GetMeetingTranscriptSegmentParams{
		ID:          segmentID,
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "transcript segment not found")
		return
	}
	if err := qtx.MarkMeetingTranscriptSeqAfterForShift(r.Context(), db.MarkMeetingTranscriptSeqAfterForShiftParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
		Seq:         original.Seq,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to split transcript segment")
		return
	}
	updated, err := qtx.UpdateMeetingTranscriptSegment(r.Context(), db.UpdateMeetingTranscriptSegmentParams{
		ID:            original.ID,
		MeetingID:     meeting.ID,
		WorkspaceID:   meeting.WorkspaceID,
		ProjectID:     meeting.ProjectID,
		SpeakerLabel:  original.SpeakerLabel,
		Text:          before,
		Confidence:    original.Confidence,
		AudioOffsetMs: original.AudioOffsetMs,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to split transcript segment")
		return
	}
	speakerAfter := strings.TrimSpace(req.SpeakerLabelAfter)
	if speakerAfter == "" {
		speakerAfter = original.SpeakerLabel
	}
	created, err := qtx.CreateMeetingTranscriptSegment(r.Context(), db.CreateMeetingTranscriptSegmentParams{
		WorkspaceID:   meeting.WorkspaceID,
		ProjectID:     meeting.ProjectID,
		MeetingID:     meeting.ID,
		Seq:           original.Seq + 1,
		SpeakerLabel:  speakerAfter,
		Text:          after,
		Confidence:    original.Confidence,
		Source:        original.Source,
		AudioOffsetMs: original.AudioOffsetMs,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to split transcript segment")
		return
	}
	if err := qtx.ShiftMarkedMeetingTranscriptSeqAfter(r.Context(), db.ShiftMarkedMeetingTranscriptSeqAfterParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
		AfterSeq:    original.Seq,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to split transcript segment")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to split transcript segment")
		return
	}
	h.publishMeetingTranscriptSegmentUpdated(meeting, updated, requestUserID(r))
	respCreated := meetingTranscriptSegmentToResponse(created)
	h.publish(protocol.EventMeetingTranscriptSegmentCreated, respCreated.WorkspaceID, "member", requestUserID(r), map[string]any{
		"meeting_id": respCreated.MeetingID,
		"segment":    respCreated,
	})
	writeJSON(w, http.StatusOK, SplitMeetingTranscriptSegmentResponse{
		Segments: []MeetingTranscriptSegmentResponse{
			meetingTranscriptSegmentToResponse(updated),
			respCreated,
		},
	})
}

func (h *Handler) MergeMeetingTranscriptSegments(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	segmentID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "segmentId"), "transcript segment id")
	if !ok {
		return
	}
	var req MergeMeetingTranscriptSegmentsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	targetID, ok := parseUUIDOrBadRequest(w, req.TargetSegmentID, "target segment id")
	if !ok {
		return
	}
	userID, ok := parseUUIDOrBadRequest(w, requestUserID(r), "user id")
	if !ok {
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to merge transcript segments")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)
	if _, err := qtx.LockMeetingTranscriptSequence(r.Context(), db.LockMeetingTranscriptSequenceParams{
		ID:          meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to merge transcript segments")
		return
	}
	first, err := qtx.GetMeetingTranscriptSegment(r.Context(), db.GetMeetingTranscriptSegmentParams{
		ID:          segmentID,
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "transcript segment not found")
		return
	}
	second, err := qtx.GetMeetingTranscriptSegment(r.Context(), db.GetMeetingTranscriptSegmentParams{
		ID:          targetID,
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "target transcript segment not found")
		return
	}
	if first.Seq-second.Seq != 1 && second.Seq-first.Seq != 1 {
		writeError(w, http.StatusBadRequest, "transcript segments must be adjacent")
		return
	}
	keep := first
	remove := second
	if second.Seq < first.Seq {
		keep = second
		remove = first
	}
	mergedText := strings.TrimSpace(keep.Text) + "\n" + strings.TrimSpace(remove.Text)
	updated, err := qtx.UpdateMeetingTranscriptSegment(r.Context(), db.UpdateMeetingTranscriptSegmentParams{
		ID:            keep.ID,
		MeetingID:     meeting.ID,
		WorkspaceID:   meeting.WorkspaceID,
		ProjectID:     meeting.ProjectID,
		SpeakerLabel:  keep.SpeakerLabel,
		Text:          strings.TrimSpace(mergedText),
		Confidence:    keep.Confidence,
		AudioOffsetMs: keep.AudioOffsetMs,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to merge transcript segments")
		return
	}
	deleted, err := qtx.SoftDeleteMeetingTranscriptSegment(r.Context(), db.SoftDeleteMeetingTranscriptSegmentParams{
		ID:              remove.ID,
		MeetingID:       meeting.ID,
		WorkspaceID:     meeting.WorkspaceID,
		ProjectID:       meeting.ProjectID,
		DeletedByUserID: userID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to merge transcript segments")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to merge transcript segments")
		return
	}
	h.publishMeetingTranscriptSegmentUpdated(meeting, updated, requestUserID(r))
	h.publishMeetingTranscriptSegmentDeleted(meeting, deleted, requestUserID(r))
	writeJSON(w, http.StatusOK, MergeMeetingTranscriptSegmentsResponse{
		Segment:          meetingTranscriptSegmentToResponse(updated),
		DeletedSegmentID: uuidToString(deleted.ID),
	})
}

func (h *Handler) ListMeetingTranscriptSegments(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	afterSeq := int32(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after_seq")); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || v < 0 {
			writeError(w, http.StatusBadRequest, "invalid after_seq")
			return
		}
		afterSeq = int32(v)
	}
	limit := int32(200)
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || v <= 0 || v > 1000 {
			writeError(w, http.StatusBadRequest, "invalid limit")
			return
		}
		limit = int32(v)
	}
	rows, err := h.Queries.ListMeetingTranscriptSegments(r.Context(), db.ListMeetingTranscriptSegmentsParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		Seq:         afterSeq,
		Limit:       limit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list transcript segments")
		return
	}
	segments := make([]MeetingTranscriptSegmentResponse, len(rows))
	for i, row := range rows {
		segments[i] = meetingTranscriptSegmentToResponse(row)
	}
	writeJSON(w, http.StatusOK, ListMeetingTranscriptSegmentsResponse{Segments: segments, Total: len(segments)})
}

func (h *Handler) ListMeetingInsightCards(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	rows, err := h.Queries.ListMeetingInsightCards(r.Context(), db.ListMeetingInsightCardsParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list insight cards")
		return
	}
	cards := make([]MeetingInsightCardResponse, len(rows))
	for i, row := range rows {
		cards[i] = meetingInsightCardToResponse(row)
	}
	writeJSON(w, http.StatusOK, ListMeetingInsightCardsResponse{Cards: cards, Total: len(cards)})
}

func (h *Handler) UpdateMeetingInsightStatus(w http.ResponseWriter, r *http.Request) {
	meeting, ok := h.meetingFromURL(w, r)
	if !ok {
		return
	}
	insightID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "insightId"), "insight id")
	if !ok {
		return
	}
	var req UpdateMeetingInsightStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	switch req.Status {
	case "open", "asked", "accepted", "ignored", "post_meeting", "resolved":
	default:
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}
	card, err := h.Queries.UpdateMeetingInsightStatus(r.Context(), db.UpdateMeetingInsightStatusParams{
		ID:          insightID,
		WorkspaceID: meeting.WorkspaceID,
		Status:      req.Status,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "insight card not found")
		return
	}
	if !uuidEqual(card.MeetingID, meeting.ID) {
		writeError(w, http.StatusNotFound, "insight card not found")
		return
	}
	resp := meetingInsightCardToResponse(card)
	h.publish(protocol.EventMeetingInsightUpdated, resp.WorkspaceID, "member", requestUserID(r), map[string]any{
		"meeting_id": resp.MeetingID,
		"card":       resp,
	})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) meetingFromURL(w http.ResponseWriter, r *http.Request) (db.MeetingSession, bool) {
	wsUUID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace id")
	if !ok {
		return db.MeetingSession{}, false
	}
	meetingID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "meeting id")
	if !ok {
		return db.MeetingSession{}, false
	}
	meeting, err := h.Queries.GetMeetingSessionInWorkspace(r.Context(), db.GetMeetingSessionInWorkspaceParams{
		ID:          meetingID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "meeting not found")
		return db.MeetingSession{}, false
	}
	return meeting, true
}

type meetingSummaryDraft struct {
	SummaryMd        string
	Decisions        []string
	Questions        []string
	Risks            []string
	Feedback         []string
	Tensions         []string
	ActionItems      []string
	MemoryCandidates []string
}

type meetingSummaryChunkDraft struct {
	SourceSeqStart int32
	SourceSeqEnd   int32
	Draft          meetingSummaryDraft
}

const meetingSummaryChunkSize = 250

func buildMeetingSummaryChunks(meeting db.MeetingSession, segments []db.MeetingTranscriptSegment) []meetingSummaryChunkDraft {
	if len(segments) == 0 {
		return nil
	}
	chunks := make([]meetingSummaryChunkDraft, 0, (len(segments)+meetingSummaryChunkSize-1)/meetingSummaryChunkSize)
	for start := 0; start < len(segments); start += meetingSummaryChunkSize {
		end := start + meetingSummaryChunkSize
		if end > len(segments) {
			end = len(segments)
		}
		window := segments[start:end]
		chunks = append(chunks, meetingSummaryChunkDraft{
			SourceSeqStart: window[0].Seq,
			SourceSeqEnd:   window[len(window)-1].Seq,
			Draft:          buildMeetingSummaryDraft(meeting, window, nil),
		})
	}
	return chunks
}

func appendMeetingSummaryChunkIndex(summaryMd string, chunks []meetingSummaryChunkDraft) string {
	var b strings.Builder
	b.WriteString(strings.TrimRight(summaryMd, "\n"))
	b.WriteString("\n\n## 分段纪要索引\n")
	for i, chunk := range chunks {
		b.WriteString("- 第 ")
		b.WriteString(strconv.Itoa(i + 1))
		b.WriteString(" 段窗口：第 ")
		b.WriteString(strconv.Itoa(int(chunk.SourceSeqStart)))
		b.WriteString(" 到第 ")
		b.WriteString(strconv.Itoa(int(chunk.SourceSeqEnd)))
		b.WriteString(" 段\n")
	}
	return b.String()
}

func buildMeetingSummaryDraft(meeting db.MeetingSession, segments []db.MeetingTranscriptSegment, cards []db.MeetingInsightCard) meetingSummaryDraft {
	draft := meetingSummaryDraft{}
	for _, segment := range segments {
		text := meetingSegmentText(segment)
		lower := strings.ToLower(text)
		switch {
		case strings.Contains(text, "决定") || strings.Contains(text, "结论") || strings.Contains(text, "确认") || strings.Contains(text, "确定"):
			draft.Decisions = appendMeetingSummaryItem(draft.Decisions, text)
		}
		if strings.Contains(text, "风险") || strings.Contains(text, "延期") || strings.Contains(text, "阻塞") || strings.Contains(text, "卡住") || strings.Contains(lower, "block") {
			draft.Risks = appendMeetingSummaryItem(draft.Risks, text)
		}
		if strings.Contains(text, "问题") || strings.Contains(text, "？") || strings.Contains(text, "?") || strings.Contains(text, "是否") {
			draft.Questions = appendMeetingSummaryItem(draft.Questions, text)
		}
		if strings.Contains(text, "反馈") || strings.Contains(text, "客户说") || strings.Contains(text, "用户说") || strings.Contains(text, "客户") || strings.Contains(text, "用户") {
			draft.Feedback = appendMeetingSummaryItem(draft.Feedback, text)
		}
		if strings.Contains(text, "既要") || (strings.Contains(text, "又要") && strings.Count(text, "要") >= 2) {
			draft.Tensions = appendMeetingSummaryItem(draft.Tensions, text)
		}
		if strings.Contains(text, "行动项") || strings.Contains(text, "待办") || strings.Contains(text, "负责") || strings.Contains(text, "今天") || strings.Contains(text, "明天") || strings.Contains(text, "下周") {
			draft.ActionItems = appendMeetingSummaryItem(draft.ActionItems, text)
		}
		if strings.Contains(text, "记住") || strings.Contains(text, "沉淀") || strings.Contains(text, "归档") || strings.Contains(text, "项目记录") {
			draft.MemoryCandidates = appendMeetingSummaryItem(draft.MemoryCandidates, text)
		}
	}
	for _, card := range cards {
		item := meetingInsightSummaryText(card)
		switch card.Type {
		case "risk":
			draft.Risks = appendMeetingSummaryItem(draft.Risks, item)
		case "question":
			draft.Questions = appendMeetingSummaryItem(draft.Questions, item)
		case "feedback":
			draft.Feedback = appendMeetingSummaryItem(draft.Feedback, item)
			draft.MemoryCandidates = appendMeetingSummaryItem(draft.MemoryCandidates, item)
		case "tension":
			draft.Tensions = appendMeetingSummaryItem(draft.Tensions, item)
		}
	}
	if len(draft.Decisions) == 0 && len(segments) > 0 {
		draft.Decisions = appendMeetingSummaryItem(draft.Decisions, "本次会议已沉淀转写记录，待会后补充明确结论。")
	}
	draft.SummaryMd = renderMeetingSummaryMarkdown(meeting, segments, draft)
	return draft
}

func meetingSegmentText(segment db.MeetingTranscriptSegment) string {
	text := strings.TrimSpace(segment.Text)
	if text == "" {
		return ""
	}
	speaker := strings.TrimSpace(segment.SpeakerLabel)
	if speaker == "" {
		return text
	}
	return speaker + "：" + text
}

func meetingInsightSummaryText(card db.MeetingInsightCard) string {
	title := strings.TrimSpace(card.Title)
	if title == "" {
		title = strings.TrimSpace(card.Type)
	}
	evidence := strings.TrimSpace(card.EvidenceQuote)
	if evidence != "" {
		return title + "：" + evidence
	}
	reason := strings.TrimSpace(card.Reason)
	if reason != "" {
		return title + "：" + reason
	}
	return title
}

func appendMeetingSummaryItem(items []string, item string) []string {
	value := strings.Trim(strings.TrimSpace(item), "-• ")
	if value == "" {
		return items
	}
	for _, existing := range items {
		if existing == value {
			return items
		}
	}
	if len(items) >= 8 {
		return items
	}
	return append(items, value)
}

func renderMeetingSummaryMarkdown(meeting db.MeetingSession, segments []db.MeetingTranscriptSegment, draft meetingSummaryDraft) string {
	title := strings.TrimSpace(meeting.Title)
	if title == "" {
		title = "未命名会议"
	}
	var b strings.Builder
	b.WriteString("# ")
	b.WriteString(title)
	b.WriteString("\n\n")
	if goal := strings.TrimSpace(meeting.Goal); goal != "" {
		b.WriteString("## 会议目标\n")
		b.WriteString(goal)
		b.WriteString("\n\n")
	}
	b.WriteString("## 核心结论\n")
	writeMeetingMarkdownList(&b, draft.Decisions)
	b.WriteString("\n## 风险与阻塞\n")
	writeMeetingMarkdownList(&b, draft.Risks)
	b.WriteString("\n## 待澄清问题\n")
	writeMeetingMarkdownList(&b, draft.Questions)
	b.WriteString("\n## 行动项\n")
	writeMeetingMarkdownList(&b, draft.ActionItems)
	b.WriteString("\n## 用户反馈\n")
	writeMeetingMarkdownList(&b, draft.Feedback)
	b.WriteString("\n## 约束冲突\n")
	writeMeetingMarkdownList(&b, draft.Tensions)
	b.WriteString("\n## 项目记忆候选\n")
	writeMeetingMarkdownList(&b, draft.MemoryCandidates)
	b.WriteString("\n## 原始转写范围\n")
	if len(segments) == 0 {
		b.WriteString("- 暂无转写记录\n")
	} else {
		b.WriteString("- 第 ")
		b.WriteString(strconv.Itoa(int(segments[0].Seq)))
		b.WriteString(" 到第 ")
		b.WriteString(strconv.Itoa(int(segments[len(segments)-1].Seq)))
		b.WriteString(" 段\n")
	}
	return b.String()
}

func writeMeetingMarkdownList(b *strings.Builder, items []string) {
	if len(items) == 0 {
		b.WriteString("- 暂无明确记录\n")
		return
	}
	for _, item := range items {
		b.WriteString("- ")
		b.WriteString(item)
		b.WriteString("\n")
	}
}

type meetingQuickInsight struct {
	Type              string
	Severity          string
	Title             string
	Reason            string
	SuggestedQuestion string
	DedupeKey         string
	Confidence        float64
}

func (h *Handler) createMeetingQuickInsight(ctx context.Context, meeting db.MeetingSession, segment db.MeetingTranscriptSegment) {
	if meeting.AnalysisStatus != "running" && meeting.AnalysisStatus != "idle" {
		return
	}
	insight, ok := classifyMeetingQuickInsight(segment)
	if !ok {
		return
	}
	card, err := h.Queries.CreateMeetingInsightCard(ctx, db.CreateMeetingInsightCardParams{
		WorkspaceID:       meeting.WorkspaceID,
		ProjectID:         meeting.ProjectID,
		MeetingID:         meeting.ID,
		Type:              insight.Type,
		Severity:          insight.Severity,
		Title:             insight.Title,
		Reason:            insight.Reason,
		SuggestedQuestion: insight.SuggestedQuestion,
		EvidenceQuote:     segment.Text,
		EvidenceSegmentID: segment.ID,
		Confidence:        insight.Confidence,
		Status:            "open",
		DedupeKey:         pgtype.Text{String: insight.DedupeKey, Valid: true},
	})
	if err != nil {
		return
	}
	resp := meetingInsightCardToResponse(card)
	h.publish(protocol.EventMeetingInsightCreated, resp.WorkspaceID, "system", "", map[string]any{
		"meeting_id": resp.MeetingID,
		"card":       resp,
	})
	if resp.Severity == "L2" || resp.Severity == "L3" {
		h.publish(protocol.EventMeetingStrongAlertCreated, resp.WorkspaceID, "system", "", map[string]any{
			"meeting_id": resp.MeetingID,
			"card":       resp,
		})
	}
}

func classifyMeetingQuickInsight(segment db.MeetingTranscriptSegment) (meetingQuickInsight, bool) {
	text := strings.TrimSpace(segment.Text)
	if text == "" {
		return meetingQuickInsight{}, false
	}
	lower := strings.ToLower(text)
	dedupePrefix := uuidToString(segment.MeetingID) + ":" + strconv.Itoa(int(segment.Seq))

	if strings.Contains(text, "既要") || (strings.Contains(text, "又要") && strings.Count(text, "要") >= 2) {
		return meetingQuickInsight{
			Type:              "tension",
			Severity:          "L3",
			Title:             "既要约束冲突",
			Reason:            "同一段发言同时提出时间、质量或范围约束，需要现场拆优先级。",
			SuggestedQuestion: "这里的优先级怎么排？如果只能保一个，先保哪个？",
			DedupeKey:         dedupePrefix + ":tension",
			Confidence:        0.72,
		}, true
	}
	if strings.Contains(text, "风险") || strings.Contains(text, "延期") || strings.Contains(text, "阻塞") || strings.Contains(text, "卡住") || strings.Contains(lower, "block") {
		return meetingQuickInsight{
			Type:              "risk",
			Severity:          "L2",
			Title:             "风险需要落责",
			Reason:            "发言中出现风险或阻塞信号，需要补齐触发条件、负责人和截止时间。",
			SuggestedQuestion: "这个风险的触发条件、负责人和截止时间分别是什么？",
			DedupeKey:         dedupePrefix + ":risk",
			Confidence:        0.68,
		}, true
	}
	if strings.Contains(text, "问题") || strings.Contains(text, "？") || strings.Contains(text, "?") {
		return meetingQuickInsight{
			Type:              "question",
			Severity:          "L1",
			Title:             "问题待澄清",
			Reason:            "发言中出现待回答问题，适合进入会中追问或会后跟进。",
			SuggestedQuestion: "这个问题需要谁给结论？",
			DedupeKey:         dedupePrefix + ":question",
			Confidence:        0.62,
		}, true
	}
	if strings.Contains(text, "反馈") || strings.Contains(text, "客户说") || strings.Contains(text, "用户说") {
		return meetingQuickInsight{
			Type:              "feedback",
			Severity:          "L1",
			Title:             "反馈需要归档",
			Reason:            "发言中出现客户或用户反馈，适合沉淀到项目记忆或后续需求池。",
			SuggestedQuestion: "这条反馈对应的用户场景和验收标准是什么？",
			DedupeKey:         dedupePrefix + ":feedback",
			Confidence:        0.6,
		}, true
	}
	return meetingQuickInsight{}, false
}
