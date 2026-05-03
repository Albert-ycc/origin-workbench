-- name: ListAgentMemories :many
SELECT * FROM agent_memory
WHERE workspace_id = $1
  AND agent_id = $2
  AND status = ANY(sqlc.arg('statuses')::text[])
ORDER BY updated_at DESC, created_at DESC
LIMIT $3;

-- name: CreateAgentMemory :one
INSERT INTO agent_memory (
    workspace_id, agent_id, kind, title, body, ref_type, ref_id, status,
    confirmed_at, confirmed_by_user_id
) VALUES (
    $1, $2, $3, $4, $5, $6, sqlc.narg('ref_id'), $7,
    CASE WHEN $7 = 'confirmed' THEN now() ELSE NULL END,
    CASE WHEN $7 = 'confirmed' THEN sqlc.narg('confirmed_by_user_id')::uuid ELSE NULL END
)
RETURNING *;

-- name: GetAgentMemoryInWorkspace :one
SELECT * FROM agent_memory
WHERE id = $1
  AND workspace_id = $2
  AND agent_id = $3;

-- name: ConfirmAgentMemory :one
UPDATE agent_memory SET
    status = 'confirmed',
    confirmed_at = now(),
    confirmed_by_user_id = sqlc.narg('confirmed_by_user_id'),
    updated_at = now()
WHERE id = $1
  AND workspace_id = $2
  AND agent_id = $3
  AND status = 'candidate'
RETURNING *;

-- name: RejectAgentMemory :one
UPDATE agent_memory SET
    status = 'rejected',
    updated_at = now()
WHERE id = $1
  AND workspace_id = $2
  AND agent_id = $3
  AND status = 'candidate'
RETURNING *;

-- name: ListAgentEvents :many
SELECT * FROM agent_event
WHERE workspace_id = $1
  AND agent_id = $2
ORDER BY created_at DESC
LIMIT $3;

-- name: CreateAgentEvent :one
INSERT INTO agent_event (
    workspace_id, agent_id, kind, title, body, payload
) VALUES (
    $1, $2, $3, $4, $5, $6
)
RETURNING *;
