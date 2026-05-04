-- =====================
-- ToolBinding CRUD (Origin §14.9)
-- =====================

-- name: ListToolBindingsForWorkspace :many
SELECT * FROM tool_binding
WHERE workspace_id = $1
ORDER BY updated_at DESC;

-- name: ListToolBindingsForMission :many
SELECT * FROM tool_binding
WHERE mission_id = $1
ORDER BY updated_at DESC;

-- name: ListToolBindingsForAgent :many
SELECT * FROM tool_binding
WHERE agent_id = $1
ORDER BY updated_at DESC;

-- name: ListToolBindingsForIdea :many
SELECT * FROM tool_binding
WHERE idea_id = $1
ORDER BY updated_at DESC;

-- name: ListToolBindingsForCouncil :many
SELECT * FROM tool_binding
WHERE council_session_id = $1
ORDER BY updated_at DESC;

-- name: GetToolBindingInWorkspace :one
SELECT * FROM tool_binding
WHERE id = $1 AND workspace_id = $2;

-- name: CreateToolBinding :one
INSERT INTO tool_binding (
    workspace_id, created_by_user_id,
    tool_type, resource_ref, label, write_enabled,
    mission_id, agent_id, idea_id, council_session_id
) VALUES (
    $1, $2,
    $3, $4, $5, $6,
    sqlc.narg('mission_id')::uuid,
    sqlc.narg('agent_id')::uuid,
    sqlc.narg('idea_id')::uuid,
    sqlc.narg('council_session_id')::uuid
)
RETURNING *;

-- name: UpdateToolBinding :one
UPDATE tool_binding SET
    label = COALESCE(sqlc.narg('label'), label),
    resource_ref = COALESCE(sqlc.narg('resource_ref')::jsonb, resource_ref),
    write_enabled = COALESCE(sqlc.narg('write_enabled'), write_enabled),
    last_synced_at = COALESCE(sqlc.narg('last_synced_at'), last_synced_at),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteToolBinding :exec
DELETE FROM tool_binding WHERE id = $1;
