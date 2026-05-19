-- Realtime meeting copilot queries (PRD §18)

-- name: ListMeetingSessions :many
SELECT * FROM meeting_session
WHERE workspace_id = $1
  AND status != 'archived'
ORDER BY updated_at DESC;

-- name: ListProjectMeetingSessions :many
SELECT * FROM meeting_session
WHERE workspace_id = $1
  AND project_id = $2
  AND status != 'archived'
ORDER BY updated_at DESC;

-- name: GetMeetingSessionInWorkspace :one
SELECT * FROM meeting_session
WHERE id = $1 AND workspace_id = $2;

-- name: CreateMeetingSession :one
INSERT INTO meeting_session (
    workspace_id,
    project_id,
    title,
    goal,
    user_role,
    strategy,
    reminder_mode,
    reminder_intensity,
    sound_enabled,
    asr_provider,
    model_source,
    analysis_status,
    created_by_user_id
)
VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
)
RETURNING *;

-- name: UpdateMeetingSession :one
UPDATE meeting_session SET
    title = COALESCE(sqlc.narg('title'), title),
    goal = COALESCE(sqlc.narg('goal'), goal),
    user_role = COALESCE(sqlc.narg('user_role'), user_role),
    strategy = COALESCE(sqlc.narg('strategy'), strategy),
    reminder_mode = COALESCE(sqlc.narg('reminder_mode'), reminder_mode),
    reminder_intensity = COALESCE(sqlc.narg('reminder_intensity'), reminder_intensity),
    sound_enabled = COALESCE(sqlc.narg('sound_enabled'), sound_enabled),
    asr_provider = COALESCE(sqlc.narg('asr_provider'), asr_provider),
    model_source = COALESCE(sqlc.narg('model_source'), model_source),
    analysis_status = COALESCE(sqlc.narg('analysis_status'), analysis_status),
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: StartMeetingSession :one
UPDATE meeting_session SET
    status = 'running',
    analysis_status = CASE
        WHEN analysis_status = 'idle' THEN 'running'
        ELSE analysis_status
    END,
    started_at = COALESCE(started_at, now()),
    stopped_at = NULL,
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: StopMeetingSession :one
UPDATE meeting_session SET
    status = 'stopped',
    analysis_status = CASE
        WHEN analysis_status = 'running' THEN 'completed'
        ELSE analysis_status
    END,
    stopped_at = COALESCE(stopped_at, now()),
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: ArchiveMeetingSession :one
UPDATE meeting_session SET
    status = 'archived',
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: GetMeetingSummary :one
SELECT
    meeting_id,
    workspace_id,
    project_id,
    summary_md,
    decisions,
    questions,
    risks,
    feedback,
    tensions,
    action_items,
    memory_candidates,
    source_seq_start,
    source_seq_end,
    generated_by,
    created_at,
    updated_at
FROM meeting_summary
WHERE meeting_id = $1
  AND workspace_id = $2;

-- name: UpsertMeetingSummary :one
INSERT INTO meeting_summary (
    meeting_id,
    workspace_id,
    project_id,
    summary_md,
    decisions,
    questions,
    risks,
    feedback,
    tensions,
    action_items,
    memory_candidates,
    source_seq_start,
    source_seq_end,
    generated_by
)
VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
)
ON CONFLICT (meeting_id) DO UPDATE SET
    summary_md = EXCLUDED.summary_md,
    decisions = EXCLUDED.decisions,
    questions = EXCLUDED.questions,
    risks = EXCLUDED.risks,
    feedback = EXCLUDED.feedback,
    tensions = EXCLUDED.tensions,
    action_items = EXCLUDED.action_items,
    memory_candidates = EXCLUDED.memory_candidates,
    source_seq_start = EXCLUDED.source_seq_start,
    source_seq_end = EXCLUDED.source_seq_end,
    generated_by = EXCLUDED.generated_by,
    updated_at = now()
RETURNING
    meeting_id,
    workspace_id,
    project_id,
    summary_md,
    decisions,
    questions,
    risks,
    feedback,
    tensions,
    action_items,
    memory_candidates,
    source_seq_start,
    source_seq_end,
    generated_by,
    created_at,
    updated_at;

-- name: CreateMeetingTranscriptSegment :one
INSERT INTO meeting_transcript_segment (
    workspace_id,
    project_id,
    meeting_id,
    seq,
    speaker_label,
    text,
    confidence,
    source,
    audio_offset_ms
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListMeetingTranscriptSegments :many
SELECT * FROM meeting_transcript_segment
WHERE meeting_id = $1
  AND workspace_id = $2
  AND seq > $3
ORDER BY seq ASC
LIMIT $4;

-- name: CreateMeetingInsightCard :one
INSERT INTO meeting_insight_card (
    workspace_id,
    project_id,
    meeting_id,
    type,
    severity,
    title,
    reason,
    suggested_question,
    evidence_quote,
    evidence_segment_id,
    evidence_start_ms,
    evidence_end_ms,
    confidence,
    status,
    dedupe_key,
    alerted_at
)
VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
    CASE WHEN $5 IN ('L2', 'L3') THEN now() ELSE NULL END
)
ON CONFLICT (meeting_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND dedupe_key <> ''
DO UPDATE SET
    severity = EXCLUDED.severity,
    title = EXCLUDED.title,
    reason = EXCLUDED.reason,
    suggested_question = EXCLUDED.suggested_question,
    evidence_quote = EXCLUDED.evidence_quote,
    evidence_segment_id = EXCLUDED.evidence_segment_id,
    evidence_start_ms = EXCLUDED.evidence_start_ms,
    evidence_end_ms = EXCLUDED.evidence_end_ms,
    confidence = EXCLUDED.confidence,
    updated_at = now()
RETURNING *;

-- name: ListMeetingInsightCards :many
SELECT * FROM meeting_insight_card
WHERE meeting_id = $1
  AND workspace_id = $2
ORDER BY
    CASE severity WHEN 'L3' THEN 0 WHEN 'L2' THEN 1 ELSE 2 END,
    created_at DESC;

-- name: UpdateMeetingInsightStatus :one
UPDATE meeting_insight_card SET
    status = $3,
    resolved_at = CASE WHEN $3 IN ('asked', 'accepted', 'ignored', 'resolved') THEN now() ELSE resolved_at END,
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;
