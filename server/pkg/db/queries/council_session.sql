-- =====================
-- Council Session CRUD
-- =====================

-- name: ListCouncilSessions :many
SELECT * FROM council_session
WHERE workspace_id = $1
  AND status <> 'archived'
ORDER BY updated_at DESC;

-- name: ListArchivedCouncilSessions :many
SELECT * FROM council_session
WHERE workspace_id = $1
  AND status = 'archived'
ORDER BY updated_at DESC;

-- name: GetCouncilSessionInWorkspace :one
SELECT * FROM council_session
WHERE id = $1 AND workspace_id = $2;

-- name: GetRunningCouncilSessionBySourceChat :one
-- Resolve the active council session that borrows this chat_session for
-- message storage. Used to fan-out @全体 broadcasts to every participant
-- when the user posts in a Council room.
SELECT * FROM council_session
WHERE source_chat_session_id = $1 AND status = 'running'
ORDER BY started_at DESC
LIMIT 1;

-- name: CreateCouncilSession :one
INSERT INTO council_session (
    workspace_id, convener_user_id, convener_agent_id,
    related_mission_id, related_idea_id, source_chat_session_id, project_id,
    topic, summary, activity_level, status
) VALUES (
    $1,
    sqlc.narg('convener_user_id')::uuid,
    sqlc.narg('convener_agent_id')::uuid,
    sqlc.narg('related_mission_id')::uuid,
    sqlc.narg('related_idea_id')::uuid,
    sqlc.narg('source_chat_session_id')::uuid,
    sqlc.narg('project_id')::uuid,
    $2, $3, $4, $5
)
RETURNING *;

-- name: UpdateCouncilSession :one
UPDATE council_session SET
    topic = COALESCE(sqlc.narg('topic'), topic),
    summary = COALESCE(sqlc.narg('summary'), summary),
    activity_level = COALESCE(sqlc.narg('activity_level'), activity_level),
    conclusion = COALESCE(sqlc.narg('conclusion'), conclusion),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: AdjournCouncilSession :one
UPDATE council_session SET
    status = 'adjourned',
    conclusion = COALESCE(sqlc.narg('conclusion'), conclusion),
    ended_at = now(),
    updated_at = now()
WHERE id = $1 AND status = 'running'
RETURNING *;

-- name: ArchiveCouncilSession :one
UPDATE council_session SET status = 'archived', updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteCouncilSession :exec
DELETE FROM council_session WHERE id = $1;

-- =====================
-- Council Session Participants
-- =====================

-- name: ListCouncilSessionParticipants :many
SELECT * FROM council_session_participant
WHERE session_id = $1
ORDER BY joined_at ASC;

-- name: AddCouncilSessionParticipant :one
INSERT INTO council_session_participant (session_id, agent_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (session_id, agent_id) DO UPDATE
    SET left_at = NULL, role = EXCLUDED.role
RETURNING *;

-- name: RemoveCouncilSessionParticipant :exec
UPDATE council_session_participant
SET left_at = now()
WHERE session_id = $1 AND agent_id = $2 AND left_at IS NULL;
