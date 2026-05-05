-- =====================
-- Team CRUD
-- =====================

-- name: ListTeams :many
SELECT * FROM team
WHERE workspace_id = $1
  AND archived_at IS NULL
ORDER BY updated_at DESC;

-- name: ListArchivedTeams :many
SELECT * FROM team
WHERE workspace_id = $1
  AND archived_at IS NOT NULL
ORDER BY updated_at DESC;

-- name: GetTeam :one
SELECT * FROM team
WHERE id = $1;

-- name: GetTeamInWorkspace :one
SELECT * FROM team
WHERE id = $1 AND workspace_id = $2;

-- name: CreateTeam :one
INSERT INTO team (
    workspace_id, name, description, captain_agent_id, created_by_user_id
) VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateTeam :one
UPDATE team SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    captain_agent_id = COALESCE(sqlc.narg('captain_agent_id')::uuid, captain_agent_id),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ArchiveTeam :one
UPDATE team SET archived_at = now(), updated_at = now()
WHERE id = $1
RETURNING *;

-- name: RestoreTeam :one
UPDATE team SET archived_at = NULL, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteTeam :exec
DELETE FROM team WHERE id = $1;

-- =====================
-- Team Member CRUD
-- =====================

-- name: ListTeamMembers :many
SELECT * FROM team_member
WHERE team_id = $1
ORDER BY
    CASE role WHEN 'captain' THEN 0 ELSE 1 END,
    joined_at ASC;

-- name: AddTeamMember :one
INSERT INTO team_member (team_id, agent_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (team_id, agent_id) DO UPDATE
    SET role = EXCLUDED.role
RETURNING *;

-- name: RemoveTeamMember :exec
DELETE FROM team_member
WHERE team_id = $1 AND agent_id = $2;

-- name: SetCaptainMember :exec
-- Atomic captain swap: demote the current captain row(s) to member and
-- promote the new agent. If the new agent is not yet a member, AddTeamMember
-- must be called first by the handler.
UPDATE team_member SET role = 'member'
WHERE team_id = $1 AND role = 'captain' AND agent_id <> $2;

-- name: PromoteTeamMember :exec
UPDATE team_member SET role = 'captain'
WHERE team_id = $1 AND agent_id = $2;

-- name: IsTeamMember :one
SELECT EXISTS(
    SELECT 1 FROM team_member
    WHERE team_id = $1 AND agent_id = $2
) AS is_member;

-- =====================
-- Team Chat (group session)
-- =====================

-- name: GetOrCreateTeamChatSession :one
-- A (team, project) pair has at most one *active* chat_session. v1.1
-- enforced this on (team_id) alone; v1.2 widens the key to
-- (team_id, project_id). The partial index also requires status = 'active'
-- so §17.4.5 compaction can archive the old row and re-INSERT a fresh
-- main chat without an ON CONFLICT collision.
INSERT INTO chat_session (workspace_id, team_id, project_id, agent_id, creator_id, title)
VALUES ($2, $1, sqlc.narg('project_id'), NULL, $3, $4)
ON CONFLICT (team_id, project_id) WHERE team_id IS NOT NULL AND status = 'active' DO UPDATE
    SET updated_at = chat_session.updated_at
RETURNING *;

-- name: GetTeamChatSession :one
-- v1.1 path (team-only group chat). project_id IS NULL means the team's
-- legacy room without a project anchor.
SELECT * FROM chat_session
WHERE team_id = $1 AND project_id IS NULL;

-- name: GetProjectMainChatSession :one
-- v1.2 path: a project's main chat is the (team, project) chat_session.
-- Used by the project workspace page to bind the left chat column.
SELECT * FROM chat_session
WHERE team_id = $1 AND project_id = $2;

-- name: ListTeamChatMessages :many
SELECT cm.*
FROM chat_message cm
INNER JOIN chat_session cs ON cs.id = cm.chat_session_id
WHERE cs.team_id = $1
ORDER BY cm.created_at ASC;

-- name: ListTeamChatMessagesPage :many
SELECT cm.*
FROM chat_message cm
INNER JOIN chat_session cs ON cs.id = cm.chat_session_id
WHERE cs.team_id = sqlc.arg('team_id')
  AND (
    sqlc.narg('before_created_at')::timestamptz IS NULL
    OR cm.created_at < sqlc.narg('before_created_at')::timestamptz
    OR (
      cm.created_at = sqlc.narg('before_created_at')::timestamptz
      AND cm.id < sqlc.narg('before_id')::uuid
    )
  )
ORDER BY cm.created_at DESC, cm.id DESC
LIMIT sqlc.arg('limit_count');

-- name: GetLatestTeamChatMessageForTask :one
SELECT cm.*
FROM chat_message cm
INNER JOIN chat_session cs ON cs.id = cm.chat_session_id
WHERE cs.team_id = $1
  AND cm.task_id = $2
ORDER BY cm.created_at DESC
LIMIT 1;

-- name: CreateTeamChatMessage :one
-- Team-scoped chat message. role='user' → sender_agent_id NULL.
-- role='assistant' → sender_agent_id required (which agent answered).
INSERT INTO chat_message (chat_session_id, role, content, sender_agent_id)
VALUES ($1, $2, $3, sqlc.narg('sender_agent_id'))
RETURNING *;
