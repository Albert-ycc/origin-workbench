-- name: CreateMeetingASRJob :one
INSERT INTO meeting_asr_job (
    workspace_id,
    project_id,
    meeting_id,
    audio_asset_id,
    provider,
    status
)
VALUES ($1, $2, $3, $4, $5, 'running')
RETURNING *;

-- name: ListMeetingASRJobs :many
SELECT * FROM meeting_asr_job
WHERE meeting_id = $1
  AND workspace_id = $2
  AND project_id = $3
ORDER BY created_at DESC;

-- name: GetMeetingASRJob :one
SELECT * FROM meeting_asr_job
WHERE id = $1
  AND meeting_id = $2
  AND workspace_id = $3
  AND project_id = $4;

-- name: MarkMeetingASRJobFailed :one
UPDATE meeting_asr_job SET
    status = 'failed',
    error_message = $5,
    updated_at = now()
WHERE id = $1
  AND meeting_id = $2
  AND workspace_id = $3
  AND project_id = $4
RETURNING *;

-- name: MarkMeetingASRJobFailedIfActive :one
UPDATE meeting_asr_job SET
    status = 'failed',
    error_message = $5,
    updated_at = now()
WHERE id = $1
  AND meeting_id = $2
  AND workspace_id = $3
  AND project_id = $4
  AND status IN ('queued', 'running')
RETURNING *;

-- name: MarkMeetingASRJobCompleted :one
UPDATE meeting_asr_job SET
    status = 'completed',
    error_message = '',
    source_seq_start = $5,
    source_seq_end = $6,
    updated_at = now()
WHERE id = $1
  AND meeting_id = $2
  AND workspace_id = $3
  AND project_id = $4
RETURNING *;

-- name: MarkMeetingASRJobCompletedIfRunning :one
UPDATE meeting_asr_job SET
    status = 'completed',
    error_message = '',
    source_seq_start = $5,
    source_seq_end = $6,
    updated_at = now()
WHERE id = $1
  AND meeting_id = $2
  AND workspace_id = $3
  AND project_id = $4
  AND status = 'running'
RETURNING *;

-- name: MarkMeetingASRJobRunningForRetry :one
UPDATE meeting_asr_job SET
    status = 'running',
    error_message = '',
    retry_count = retry_count + 1,
    updated_at = now()
WHERE id = $1
  AND meeting_id = $2
  AND workspace_id = $3
  AND project_id = $4
  AND status = 'failed'
RETURNING *;

-- name: RecoverStaleMeetingASRJobs :many
UPDATE meeting_asr_job SET
    status = 'failed',
    error_message = $2,
    updated_at = now()
WHERE status IN ('queued', 'running')
  AND updated_at < $1
RETURNING *;
