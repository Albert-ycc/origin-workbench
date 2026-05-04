-- =====================
-- Idea CRUD
-- =====================

-- name: ListIdeas :many
-- "Active" pool excludes both archived (manually shelved) and promoted
-- (already became a Mission and moved on). The mutation cache mirrors this
-- by removing the promoted idea from the list — keep both ends in sync.
SELECT * FROM idea
WHERE workspace_id = $1
  AND status NOT IN ('archived', 'promoted')
ORDER BY
  CASE WHEN last_nurtured_at IS NULL THEN updated_at ELSE last_nurtured_at END DESC;

-- name: ListArchivedIdeas :many
SELECT * FROM idea
WHERE workspace_id = $1
  AND status = 'archived'
ORDER BY updated_at DESC;

-- name: GetIdeaInWorkspace :one
SELECT * FROM idea
WHERE id = $1 AND workspace_id = $2;

-- name: CreateIdea :one
INSERT INTO idea (
    workspace_id, created_by_user_id, nurturer_agent_id,
    title, description, source, source_ref, tags, status
) VALUES (
    $1, $2, sqlc.narg('nurturer_agent_id')::uuid,
    $3, $4, $5, $6, $7, $8
)
RETURNING *;

-- name: UpdateIdea :one
UPDATE idea SET
    title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    status = COALESCE(sqlc.narg('status'), status),
    nurturer_agent_id = COALESCE(sqlc.narg('nurturer_agent_id')::uuid, nurturer_agent_id),
    tags = COALESCE(sqlc.narg('tags')::text[], tags),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ClearIdeaNurturer :one
UPDATE idea SET
    nurturer_agent_id = NULL,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: PromoteIdeaToMission :one
UPDATE idea SET
    status = 'promoted',
    promoted_mission_id = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ArchiveIdea :one
UPDATE idea SET status = 'archived', updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteIdea :exec
DELETE FROM idea WHERE id = $1;

-- name: TouchIdeaNurturedAt :one
UPDATE idea SET last_nurtured_at = now(), updated_at = now()
WHERE id = $1
RETURNING *;

-- =====================
-- Idea Nurture Note CRUD
-- =====================

-- name: ListIdeaNurtureNotes :many
SELECT * FROM idea_nurture_note
WHERE idea_id = $1
ORDER BY created_at DESC;

-- name: CreateIdeaNurtureNote :one
INSERT INTO idea_nurture_note (
    idea_id, author_agent_id, kind, summary, body, references_payload
) VALUES (
    $1, sqlc.narg('author_agent_id')::uuid, $2, $3, $4, $5
)
RETURNING *;

-- name: DeleteIdeaNurtureNoteInIdea :one
DELETE FROM idea_nurture_note
WHERE id = $1 AND idea_id = $2
RETURNING id;
