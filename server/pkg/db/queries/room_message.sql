-- =====================
-- Room Message
-- =====================

-- name: ListRoomMessages :many
-- 游标分页，按 created_at DESC 倒序，前端滚动加载历史消息
SELECT * FROM room_message
WHERE room_id = sqlc.arg('room_id')
  AND (
    sqlc.narg('before_created_at')::timestamptz IS NULL
    OR created_at < sqlc.narg('before_created_at')::timestamptz
    OR (
      created_at = sqlc.narg('before_created_at')::timestamptz
      AND id < sqlc.narg('before_id')::uuid
    )
  )
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('limit_count');

-- name: CreateRoomMessage :one
INSERT INTO room_message (room_id, sender_type, sender_id, content, reply_to_message_id, mentions, is_autonomous)
VALUES ($1, $2, $3, $4,
    sqlc.narg('reply_to_message_id')::uuid,
    $5,
    $6)
RETURNING *;

-- name: GetRoomMessage :one
SELECT * FROM room_message WHERE id = $1;

-- name: ListRoomMessagesBySender :many
SELECT * FROM room_message
WHERE room_id = $1 AND sender_type = $2 AND sender_id = $3
ORDER BY created_at DESC
LIMIT $4;

-- name: ListMentioningMessages :many
-- 找出 mentions 数组里包含指定 agent/user id 字符串的消息
SELECT * FROM room_message
WHERE room_id = $1 AND $2::text = ANY(mentions)
ORDER BY created_at DESC
LIMIT $3;

-- name: GetLatestRoomMessage :one
SELECT * FROM room_message
WHERE room_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 1;
