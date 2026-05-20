-- =====================
-- Room Member
-- =====================

-- name: ListRoomMembers :many
SELECT * FROM room_member
WHERE room_id = $1 AND left_at IS NULL
ORDER BY joined_at ASC;

-- name: ListRoomMembersByType :many
SELECT * FROM room_member
WHERE room_id = $1 AND member_type = $2 AND left_at IS NULL
ORDER BY joined_at ASC;

-- name: GetRoomMember :one
SELECT * FROM room_member
WHERE room_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL;

-- name: AddRoomMember :one
INSERT INTO room_member (room_id, member_type, member_id, role)
VALUES ($1, $2, $3, $4)
ON CONFLICT (room_id, member_type, member_id) DO UPDATE
    SET left_at = NULL, role = EXCLUDED.role, joined_at = now()
RETURNING *;

-- name: RemoveRoomMember :exec
-- soft delete: 写 left_at 而不是物理删除，保留历史
UPDATE room_member SET left_at = now()
WHERE room_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL;

-- name: ListActiveRoomAgents :many
-- 列出 room 内所有活跃 agent 成员（left_at IS NULL + member_type = 'agent'）
SELECT * FROM room_member
WHERE room_id = $1 AND member_type = 'agent' AND left_at IS NULL
ORDER BY joined_at ASC;

-- name: GetRoomOwner :one
SELECT * FROM room_member
WHERE room_id = $1 AND role = 'owner' AND left_at IS NULL
LIMIT 1;

-- name: CountRoomMembers :one
SELECT COUNT(*)::int AS count FROM room_member
WHERE room_id = $1 AND left_at IS NULL;
