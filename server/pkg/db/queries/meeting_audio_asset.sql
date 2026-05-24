-- name: CreateMeetingAudioAsset :one
INSERT INTO meeting_audio_asset (
    id,
    workspace_id,
    project_id,
    meeting_id,
    storage_key,
    file_url,
    filename,
    content_type,
    size_bytes,
    duration_seconds,
    created_by_user_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: ListMeetingAudioAssets :many
SELECT * FROM meeting_audio_asset
WHERE meeting_id = $1
  AND workspace_id = $2
  AND project_id = $3
  AND status != 'deleted'
ORDER BY created_at DESC;

-- name: GetMeetingAudioAsset :one
SELECT * FROM meeting_audio_asset
WHERE id = $1
  AND meeting_id = $2
  AND workspace_id = $3
  AND project_id = $4;

-- name: MarkMeetingAudioAssetDeleted :one
UPDATE meeting_audio_asset SET
    status = 'deleted',
    updated_at = now()
WHERE id = $1
  AND meeting_id = $2
  AND workspace_id = $3
  AND project_id = $4
RETURNING *;
