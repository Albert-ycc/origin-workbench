-- v1.2 project workspace queries (PRD §17)
-- Note: file named project_v12 to avoid colliding with v1.0 project queries
-- (those still exist for legacy issue-classification path; v1.2 adds the
--  new product-level surface).

-- name: ListProjectsV12 :many
SELECT * FROM project
WHERE workspace_id = $1
  AND status IN ('active', 'paused', 'completed')
ORDER BY
  CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
  updated_at DESC;

-- name: ListActiveProjectsV12 :many
-- For sidebar: only active + paused, newest first
SELECT * FROM project
WHERE workspace_id = $1 AND status IN ('active', 'paused')
ORDER BY updated_at DESC;

-- name: GetProjectV12 :one
SELECT * FROM project WHERE id = $1;

-- name: GetProjectInWorkspaceV12 :one
SELECT * FROM project WHERE id = $1 AND workspace_id = $2;

-- name: CreateProjectV12 :one
INSERT INTO project (
    workspace_id, team_id, title, description, local_dir, memory_doc, status
)
VALUES ($1, $2, $3, $4, $5, $6, 'active')
RETURNING *;

-- name: UpdateProjectV12 :one
UPDATE project SET
    title       = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    status      = COALESCE(sqlc.narg('status'), status),
    memory_doc  = COALESCE(sqlc.narg('memory_doc'), memory_doc),
    memory_doc_updated_at = COALESCE(sqlc.narg('memory_doc_updated_at'), memory_doc_updated_at),
    updated_at  = now()
WHERE id = $1
RETURNING *;

-- name: SetProjectMainChatSessionV12 :exec
-- Bind the project's main chat session anchor. Only writes when current value
-- is NULL so the first compaction-rewrite or boot-time backfill cannot
-- clobber a session the user is actively chatting in.
UPDATE project SET main_chat_session_id = $2, updated_at = now()
WHERE id = $1 AND main_chat_session_id IS NULL;

-- name: ReplaceProjectMainChatSessionV12 :exec
-- Replace the bound main chat session unconditionally. Compaction (§17.4.5)
-- archives the old session and points the project at a freshly-created one.
UPDATE project SET main_chat_session_id = $2, updated_at = now()
WHERE id = $1;

-- name: ArchiveProjectV12 :one
UPDATE project SET status = 'archived', updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteProjectV12 :exec
DELETE FROM project WHERE id = $1;

-- name: IncrementProjectCompactionV12 :one
UPDATE project SET
    compaction_count = compaction_count + 1,
    memory_doc_updated_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListProjectsByTeamV12 :many
SELECT * FROM project
WHERE team_id = $1 AND status != 'archived'
ORDER BY updated_at DESC;

-- ============================================================
-- agent_project_memory (per-agent per-project视角记忆, PRD §17.2.3)
-- ============================================================

-- name: GetAgentProjectMemory :one
SELECT * FROM agent_project_memory WHERE agent_id = $1 AND project_id = $2;

-- name: ListAgentProjectMemoriesByProject :many
SELECT * FROM agent_project_memory WHERE project_id = $1
ORDER BY updated_at DESC;

-- name: UpsertAgentProjectMemory :one
INSERT INTO agent_project_memory (agent_id, project_id, content, last_auto_compaction_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (agent_id, project_id) DO UPDATE SET
    content = EXCLUDED.content,
    last_auto_compaction_at = COALESCE(EXCLUDED.last_auto_compaction_at, agent_project_memory.last_auto_compaction_at),
    updated_at = now()
RETURNING *;
