package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// Meeting copilot endpoints (PRD §18).
//
// MVP capture path is intentionally narrow: the desktop renderer captures mic
// permission and submits text transcript segments. The backend stores session
// state, transcript, evidence-backed cards, and realtime events; it does not
// receive raw audio in this phase.

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
}

type ListMeetingTranscriptSegmentsResponse struct {
	Segments []MeetingTranscriptSegmentResponse `json:"segments"`
	Total    int                                `json:"total"`
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
	if req.Seq <= 0 {
		writeError(w, http.StatusBadRequest, "seq must be positive")
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
	segment, err := h.Queries.CreateMeetingTranscriptSegment(r.Context(), db.CreateMeetingTranscriptSegmentParams{
		WorkspaceID:   meeting.WorkspaceID,
		ProjectID:     meeting.ProjectID,
		MeetingID:     meeting.ID,
		Seq:           req.Seq,
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
	resp := meetingTranscriptSegmentToResponse(segment)
	h.publish(protocol.EventMeetingTranscriptSegmentCreated, resp.WorkspaceID, "member", requestUserID(r), map[string]any{
		"meeting_id": resp.MeetingID,
		"segment":    resp,
	})
	h.createMeetingQuickInsight(r.Context(), meeting, segment)
	writeJSON(w, http.StatusCreated, resp)
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
