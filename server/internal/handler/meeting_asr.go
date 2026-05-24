package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/storage"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const (
	meetingASRLocalCommandEnv        = "MEETING_ASR_LOCAL_COMMAND"
	meetingASRLocalTimeoutSecondsEnv = "MEETING_ASR_LOCAL_TIMEOUT_SECONDS"
	meetingASRExternalEndpointEnv    = "MEETING_ASR_EXTERNAL_ENDPOINT"
	meetingASRExternalAPIKeyEnv      = "MEETING_ASR_EXTERNAL_API_KEY"
	meetingASRExternalTimeoutEnv     = "MEETING_ASR_EXTERNAL_TIMEOUT_SECONDS"
	meetingASRCommandOutputLimit     = 1 << 20
	meetingASRInterruptedMessage     = "meeting ASR job was interrupted before completion; retry transcription to continue"
)

type MeetingASRRunner struct {
	handler *Handler
	storage storage.Storage
}

type meetingASRSegmentDraft struct {
	SpeakerLabel  string
	Text          string
	Confidence    float64
	AudioOffsetMs pgtype.Int4
}

type meetingASRCommandSegment struct {
	SpeakerLabel string   `json:"speaker_label"`
	Text         string   `json:"text"`
	Start        *float64 `json:"start"`
	StartMs      *int32   `json:"start_ms"`
	Confidence   *float64 `json:"confidence"`
}

type meetingASRCommandOutput struct {
	Segments []meetingASRCommandSegment `json:"segments"`
}

type MeetingASRProviderStatusResponse struct {
	Configured  bool   `json:"configured"`
	Available   bool   `json:"available"`
	CommandName string `json:"command_name,omitempty"`
	TimeoutSec  int    `json:"timeout_seconds"`
	Error       string `json:"error,omitempty"`
}

type MeetingASRStatusResponse struct {
	Local    MeetingASRProviderStatusResponse `json:"local"`
	External MeetingASRProviderStatusResponse `json:"external"`
}

type limitedBuffer struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.limit <= 0 {
		return len(p), nil
	}
	remaining := b.limit - b.buf.Len()
	if remaining <= 0 {
		b.truncated = true
		return len(p), nil
	}
	if len(p) > remaining {
		b.truncated = true
		_, _ = b.buf.Write(p[:remaining])
		return len(p), nil
	}
	_, _ = b.buf.Write(p)
	return len(p), nil
}

func (b *limitedBuffer) String() string {
	out := strings.TrimSpace(b.buf.String())
	if b.truncated {
		if out != "" {
			out += " "
		}
		out += "(truncated)"
	}
	return out
}

func meetingASRLocalTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv(meetingASRLocalTimeoutSecondsEnv))
	if raw == "" {
		return 10 * time.Minute
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return 10 * time.Minute
	}
	if seconds > 1800 {
		seconds = 1800
	}
	return time.Duration(seconds) * time.Second
}

func meetingASRExternalTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv(meetingASRExternalTimeoutEnv))
	if raw == "" {
		return 10 * time.Minute
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return 10 * time.Minute
	}
	if seconds > 1800 {
		seconds = 1800
	}
	return time.Duration(seconds) * time.Second
}

func parseMeetingASRLocalCommand(command string) ([]string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return nil, errors.New("local ASR command is empty")
	}
	var parts []string
	var b strings.Builder
	var quote rune
	escaped := false
	flush := func() {
		if b.Len() == 0 {
			return
		}
		parts = append(parts, b.String())
		b.Reset()
	}
	for _, r := range command {
		if escaped {
			b.WriteRune(r)
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		if quote != 0 {
			if r == quote {
				quote = 0
				continue
			}
			b.WriteRune(r)
			continue
		}
		if r == '"' || r == '\'' {
			quote = r
			continue
		}
		if unicode.IsSpace(r) {
			flush()
			continue
		}
		b.WriteRune(r)
	}
	if escaped {
		b.WriteRune('\\')
	}
	if quote != 0 {
		return nil, errors.New("local ASR command has unterminated quote")
	}
	flush()
	if len(parts) == 0 {
		return nil, errors.New("local ASR command is empty")
	}
	return parts, nil
}

func meetingASRLocalCommandStatus() MeetingASRProviderStatusResponse {
	status := MeetingASRProviderStatusResponse{
		TimeoutSec: int(meetingASRLocalTimeout().Seconds()),
	}
	command := strings.TrimSpace(os.Getenv(meetingASRLocalCommandEnv))
	if command == "" {
		status.Error = "local ASR command not configured"
		return status
	}
	parts, err := parseMeetingASRLocalCommand(command)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	status.Configured = true
	status.CommandName = filepath.Base(parts[0])
	if _, err := exec.LookPath(parts[0]); err != nil {
		status.Error = "local ASR command not found"
		return status
	}
	status.Available = true
	return status
}

func meetingASRExternalProviderStatus() MeetingASRProviderStatusResponse {
	status := MeetingASRProviderStatusResponse{
		CommandName: "external-asr",
		TimeoutSec:  int(meetingASRExternalTimeout().Seconds()),
	}
	endpoint := strings.TrimSpace(os.Getenv(meetingASRExternalEndpointEnv))
	if endpoint == "" {
		status.Error = "external ASR endpoint not configured"
		return status
	}
	status.Configured = true
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		status.Error = "external ASR endpoint is invalid"
		return status
	}
	status.Available = true
	return status
}

func (h *Handler) GetMeetingASRStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, MeetingASRStatusResponse{
		Local:    meetingASRLocalCommandStatus(),
		External: meetingASRExternalProviderStatus(),
	})
}

func parseMeetingASRCommandOutput(data []byte) ([]meetingASRSegmentDraft, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return nil, errors.New("local ASR command returned empty output")
	}

	var rawSegments []meetingASRCommandSegment
	if bytes.HasPrefix(trimmed, []byte("[")) {
		if err := json.Unmarshal(trimmed, &rawSegments); err != nil {
			return nil, fmt.Errorf("local ASR command returned invalid JSON: %w", err)
		}
	} else {
		var output meetingASRCommandOutput
		if err := json.Unmarshal(trimmed, &output); err != nil {
			return nil, fmt.Errorf("local ASR command returned invalid JSON: %w", err)
		}
		rawSegments = output.Segments
	}
	if len(rawSegments) == 0 {
		return nil, errors.New("local ASR command returned no transcript segments")
	}

	segments := make([]meetingASRSegmentDraft, 0, len(rawSegments))
	for _, raw := range rawSegments {
		text := strings.TrimSpace(raw.Text)
		if text == "" {
			continue
		}
		speaker := strings.TrimSpace(raw.SpeakerLabel)
		if speaker == "" {
			speaker = "录音转写"
		}
		confidence := 0.0
		if raw.Confidence != nil {
			confidence = *raw.Confidence
		}
		var offset pgtype.Int4
		if raw.StartMs != nil && *raw.StartMs >= 0 {
			offset = pgtype.Int4{Int32: *raw.StartMs, Valid: true}
		} else if raw.Start != nil && *raw.Start >= 0 {
			offset = pgtype.Int4{Int32: int32(*raw.Start * 1000), Valid: true}
		}
		segments = append(segments, meetingASRSegmentDraft{
			SpeakerLabel:  speaker,
			Text:          text,
			Confidence:    confidence,
			AudioOffsetMs: offset,
		})
	}
	if len(segments) == 0 {
		return nil, errors.New("local ASR command returned no usable transcript text")
	}
	return segments, nil
}

func (r *MeetingASRRunner) runLocalMeetingASRCommand(ctx context.Context, asset db.MeetingAudioAsset) ([]meetingASRSegmentDraft, error) {
	if r.storage == nil {
		return nil, errors.New("ASR provider local not configured; audio storage is unavailable")
	}
	command := strings.TrimSpace(os.Getenv(meetingASRLocalCommandEnv))
	if command == "" {
		return nil, errors.New("ASR provider local not configured; audio is saved and can be manually transcribed")
	}
	parts, err := parseMeetingASRLocalCommand(command)
	if err != nil {
		return nil, fmt.Errorf("ASR provider local not configured; %w", err)
	}

	data, err := r.storage.Read(ctx, asset.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to read meeting audio asset: %w", err)
	}
	tmp, err := os.CreateTemp("", "origin-meeting-asr-*"+filepath.Ext(asset.Filename))
	if err != nil {
		return nil, fmt.Errorf("failed to prepare meeting audio for ASR: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return nil, fmt.Errorf("failed to write meeting audio for ASR: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return nil, fmt.Errorf("failed to close meeting audio temp file: %w", err)
	}

	runCtx, cancel := context.WithTimeout(ctx, meetingASRLocalTimeout())
	defer cancel()
	args := append(append([]string{}, parts[1:]...), tmpPath)
	cmd := exec.CommandContext(runCtx, parts[0], args...)
	cmd.Env = append(os.Environ(),
		"MEETING_ASR_AUDIO_PATH="+tmpPath,
		"MEETING_ASR_AUDIO_FILENAME="+asset.Filename,
	)
	stdout := &limitedBuffer{limit: meetingASRCommandOutputLimit}
	stderr := &limitedBuffer{limit: 16 * 1024}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return nil, errors.New("local ASR command timed out")
		}
		msg := stderr.String()
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("local ASR command failed: %s", msg)
	}
	return parseMeetingASRCommandOutput(stdout.buf.Bytes())
}

func (r *MeetingASRRunner) runExternalMeetingASRProvider(ctx context.Context, asset db.MeetingAudioAsset) ([]meetingASRSegmentDraft, error) {
	if r.storage == nil {
		return nil, errors.New("ASR provider external not configured; audio storage is unavailable")
	}
	endpoint := strings.TrimSpace(os.Getenv(meetingASRExternalEndpointEnv))
	if endpoint == "" {
		return nil, errors.New("ASR provider external not configured; audio is saved and can be manually transcribed")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("ASR provider external not configured; endpoint is invalid")
	}
	data, err := r.storage.Read(ctx, asset.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to read meeting audio asset: %w", err)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", asset.Filename)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare external ASR request: %w", err)
	}
	if _, err := part.Write(data); err != nil {
		return nil, fmt.Errorf("failed to prepare external ASR audio payload: %w", err)
	}
	_ = writer.WriteField("filename", asset.Filename)
	_ = writer.WriteField("content_type", asset.ContentType)
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("failed to finalize external ASR request: %w", err)
	}

	runCtx, cancel := context.WithTimeout(ctx, meetingASRExternalTimeout())
	defer cancel()
	req, err := http.NewRequestWithContext(runCtx, http.MethodPost, endpoint, &body)
	if err != nil {
		return nil, fmt.Errorf("failed to create external ASR request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	if apiKey := strings.TrimSpace(os.Getenv(meetingASRExternalAPIKeyEnv)); apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	client := &http.Client{Timeout: meetingASRExternalTimeout()}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return nil, errors.New("external ASR request timed out")
		}
		return nil, fmt.Errorf("external ASR request failed: %w", err)
	}
	defer resp.Body.Close()
	responseData, err := io.ReadAll(io.LimitReader(resp.Body, meetingASRCommandOutputLimit))
	if err != nil {
		return nil, fmt.Errorf("failed to read external ASR response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(string(responseData))
		if len(message) > 1000 {
			message = message[:1000] + "..."
		}
		if message == "" {
			message = resp.Status
		}
		return nil, fmt.Errorf("external ASR request failed with status %d: %s", resp.StatusCode, message)
	}
	return parseMeetingASRCommandOutput(responseData)
}

func (r *MeetingASRRunner) transcribeMeetingAudio(ctx context.Context, asset db.MeetingAudioAsset, provider string) ([]meetingASRSegmentDraft, error) {
	switch provider {
	case "local":
		return r.runLocalMeetingASRCommand(ctx, asset)
	case "external":
		return r.runExternalMeetingASRProvider(ctx, asset)
	default:
		return nil, fmt.Errorf("ASR provider %s not configured; audio is saved and can be manually transcribed", provider)
	}
}

func (r *MeetingASRRunner) markMeetingASRJobFailed(ctx context.Context, meeting db.MeetingSession, job db.MeetingAsrJob, message string) (db.MeetingAsrJob, error) {
	if strings.TrimSpace(message) == "" {
		message = "meeting ASR job failed"
	}
	if len(message) > 1000 {
		message = message[:1000] + "..."
	}
	return r.handler.Queries.MarkMeetingASRJobFailedIfActive(ctx, db.MarkMeetingASRJobFailedIfActiveParams{
		ID:           job.ID,
		MeetingID:    meeting.ID,
		WorkspaceID:  meeting.WorkspaceID,
		ProjectID:    meeting.ProjectID,
		ErrorMessage: message,
	})
}

func (r *MeetingASRRunner) runMeetingASRJob(ctx context.Context, meeting db.MeetingSession, asset db.MeetingAudioAsset, job db.MeetingAsrJob, actorID string) (db.MeetingAsrJob, error) {
	drafts, err := r.transcribeMeetingAudio(ctx, asset, job.Provider)
	if err != nil {
		return r.markMeetingASRJobFailed(ctx, meeting, job, err.Error())
	}

	tx, err := r.handler.TxStarter.Begin(ctx)
	if err != nil {
		return job, err
	}
	defer tx.Rollback(ctx)
	qtx := r.handler.Queries.WithTx(tx)

	if _, err := qtx.LockMeetingTranscriptSequence(ctx, db.LockMeetingTranscriptSequenceParams{
		ID:          meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	}); err != nil {
		return job, err
	}
	nextSeq, err := qtx.NextMeetingTranscriptSeq(ctx, db.NextMeetingTranscriptSeqParams{
		MeetingID:   meeting.ID,
		WorkspaceID: meeting.WorkspaceID,
		ProjectID:   meeting.ProjectID,
	})
	if err != nil {
		return job, err
	}

	created := make([]db.MeetingTranscriptSegment, 0, len(drafts))
	for i, draft := range drafts {
		segment, err := qtx.CreateMeetingTranscriptSegment(ctx, db.CreateMeetingTranscriptSegmentParams{
			WorkspaceID:   meeting.WorkspaceID,
			ProjectID:     meeting.ProjectID,
			MeetingID:     meeting.ID,
			Seq:           nextSeq + int32(i),
			SpeakerLabel:  draft.SpeakerLabel,
			Text:          draft.Text,
			Confidence:    draft.Confidence,
			Source:        job.Provider,
			AudioOffsetMs: draft.AudioOffsetMs,
		})
		if err != nil {
			return job, err
		}
		created = append(created, segment)
	}

	completed, err := qtx.MarkMeetingASRJobCompletedIfRunning(ctx, db.MarkMeetingASRJobCompletedIfRunningParams{
		ID:             job.ID,
		MeetingID:      meeting.ID,
		WorkspaceID:    meeting.WorkspaceID,
		ProjectID:      meeting.ProjectID,
		SourceSeqStart: pgtype.Int4{Int32: nextSeq, Valid: true},
		SourceSeqEnd:   pgtype.Int4{Int32: nextSeq + int32(len(created)) - 1, Valid: true},
	})
	if err != nil {
		return job, err
	}
	if err := tx.Commit(ctx); err != nil {
		return job, err
	}

	for _, segment := range created {
		resp := meetingTranscriptSegmentToResponse(segment)
		r.handler.publish(protocol.EventMeetingTranscriptSegmentCreated, resp.WorkspaceID, "member", actorID, map[string]any{
			"meeting_id": resp.MeetingID,
			"segment":    resp,
		})
		r.handler.createMeetingQuickInsight(ctx, meeting, segment)
	}
	return completed, nil
}

func (r *MeetingASRRunner) Start(meeting db.MeetingSession, asset db.MeetingAudioAsset, job db.MeetingAsrJob, actorID string) {
	r.handler.publishMeetingASRJobUpdated(meeting, job, actorID)
	go func() {
		completed, err := r.runMeetingASRJob(context.Background(), meeting, asset, job, actorID)
		if err != nil {
			slog.Error("failed to run meeting asr job", "job_id", uuidToString(job.ID), "meeting_id", uuidToString(meeting.ID), "error", err)
			return
		}
		r.handler.publishMeetingASRJobUpdated(meeting, completed, actorID)
	}()
}

func (r *MeetingASRRunner) RecoverStaleJobs(ctx context.Context, cutoff time.Time) ([]db.MeetingAsrJob, error) {
	jobs, err := r.handler.Queries.RecoverStaleMeetingASRJobs(ctx, db.RecoverStaleMeetingASRJobsParams{
		UpdatedAt:    pgtype.Timestamptz{Time: cutoff, Valid: true},
		ErrorMessage: meetingASRInterruptedMessage,
	})
	if err != nil {
		return nil, err
	}
	for _, job := range jobs {
		meeting, err := r.handler.Queries.GetMeetingSessionInWorkspace(ctx, db.GetMeetingSessionInWorkspaceParams{
			ID:          job.MeetingID,
			WorkspaceID: job.WorkspaceID,
		})
		if err != nil {
			continue
		}
		r.handler.publishMeetingASRJobUpdated(meeting, job, "system")
	}
	return jobs, nil
}

func (h *Handler) meetingASRRunner() *MeetingASRRunner {
	return &MeetingASRRunner{
		handler: h,
		storage: h.Storage,
	}
}

func (h *Handler) runMeetingASRJob(ctx context.Context, meeting db.MeetingSession, asset db.MeetingAudioAsset, job db.MeetingAsrJob, actorID string) (db.MeetingAsrJob, error) {
	return h.meetingASRRunner().runMeetingASRJob(ctx, meeting, asset, job, actorID)
}

func (h *Handler) startMeetingASRJob(meeting db.MeetingSession, asset db.MeetingAudioAsset, job db.MeetingAsrJob, actorID string) {
	h.meetingASRRunner().Start(meeting, asset, job, actorID)
}

func (h *Handler) RecoverStaleMeetingASRJobs(ctx context.Context, cutoff time.Time) ([]db.MeetingAsrJob, error) {
	return h.meetingASRRunner().RecoverStaleJobs(ctx, cutoff)
}
