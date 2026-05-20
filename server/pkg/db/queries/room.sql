-- =====================
-- Room CRUD
-- =====================

-- name: ListRooms :many
SELECT * FROM room
WHERE workspace_id = $1
  AND archived_at IS NULL
ORDER BY last_active_at DESC;

-- name: GetRoom :one
SELECT * FROM room
WHERE id = $1;

-- name: GetRoomInWorkspace :one
SELECT * FROM room
WHERE id = $1 AND workspace_id = $2;

-- name: CreateRoom :one
INSERT INTO room (workspace_id, name, description, theme)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateRoom :one
UPDATE room SET
    name        = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    theme       = COALESCE(sqlc.narg('theme'), theme),
    updated_at  = now()
WHERE id = $1
RETURNING *;

-- name: ArchiveRoom :one
UPDATE room SET
    archived_at = now(),
    updated_at  = now()
WHERE id = $1 AND archived_at IS NULL
RETURNING *;

-- name: TouchRoomActiveAt :exec
UPDATE room SET last_active_at = now(), updated_at = now()
WHERE id = $1;

-- name: DeleteRoom :exec
-- 只允许删除已归档的 room，未归档的走 ArchiveRoom
DELETE FROM room WHERE id = $1 AND archived_at IS NOT NULL;
