-- name: CreateChatSession :one
INSERT INTO chat_session (workspace_id, agent_id, creator_id, title)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetChatSession :one
SELECT * FROM chat_session
WHERE id = $1;

-- name: GetChatSessionInWorkspace :one
SELECT * FROM chat_session
WHERE id = $1 AND workspace_id = $2;

-- name: ListChatSessionsByCreator :many
-- Returns active sessions with a boolean unread flag. Unread is strictly
-- per-session: either the user has uncleared assistant replies in this
-- session or they don't. Counting messages would be misleading.
-- is_room_internal=TRUE の session は客厅内部仮想 session なので sidebar から除外。
SELECT cs.*,
       (cs.unread_since IS NOT NULL)::bool AS has_unread
FROM chat_session cs
WHERE cs.workspace_id = $1 AND cs.creator_id = $2 AND cs.status = 'active'
  AND cs.team_id IS NULL
  AND cs.is_room_internal = FALSE
ORDER BY cs.updated_at DESC;

-- name: ListAllChatSessionsByCreator :many
SELECT cs.*,
       (cs.unread_since IS NOT NULL)::bool AS has_unread
FROM chat_session cs
WHERE cs.workspace_id = $1 AND cs.creator_id = $2
  AND cs.team_id IS NULL
  AND cs.is_room_internal = FALSE
ORDER BY cs.updated_at DESC;

-- name: UpdateChatSessionTitle :one
UPDATE chat_session SET title = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateChatSessionSession :exec
-- Updates the resume pointer for a chat session. Empty/NULL inputs are
-- ignored via COALESCE so a task that completes without a session_id (e.g.
-- the agent crashed before establishing one) cannot wipe out a previously
-- recorded resume pointer. This makes the chat memory robust against
-- intermittent agent failures.
UPDATE chat_session
SET session_id = COALESCE(sqlc.narg('session_id'), session_id),
    work_dir = COALESCE(sqlc.narg('work_dir'), work_dir),
    updated_at = now()
WHERE id = sqlc.arg('id');

-- name: ArchiveChatSession :exec
UPDATE chat_session SET status = 'archived', updated_at = now()
WHERE id = $1;

-- name: ArchiveChatSessionWithCompactionPointer :exec
-- Used by §17.4.5 compaction: archives the old main chat and stamps the
-- compacted_into_session_id pointer so the right-rail "归档会话" tab can
-- thread back to the new session.
UPDATE chat_session
SET status = 'archived',
    compacted_into_session_id = $2,
    last_compacted_at = now(),
    updated_at = now()
WHERE id = $1;

-- name: ListArchivedChatSessionsByProject :many
-- Right-rail "归档会话" Tab — chronological list of all archived main chat
-- sessions for a project, plus the compaction pointer so the UI can group
-- "snapshot N → snapshot N+1".
SELECT * FROM chat_session
WHERE project_id = $1 AND status = 'archived'
ORDER BY last_compacted_at DESC NULLS LAST, created_at DESC;

-- name: TouchChatSession :exec
UPDATE chat_session SET updated_at = now()
WHERE id = $1;

-- name: CreateChatMessage :one
INSERT INTO chat_message (chat_session_id, role, content, task_id, failure_reason, elapsed_ms, sender_agent_id)
VALUES ($1, $2, $3, sqlc.narg(task_id), sqlc.narg(failure_reason), sqlc.narg(elapsed_ms), sqlc.narg(sender_agent_id))
RETURNING *;

-- name: ListChatMessages :many
SELECT * FROM chat_message
WHERE chat_session_id = $1
ORDER BY created_at ASC;

-- name: ListChatMessagesBySessionPage :many
-- Cursor-paginated per-session message list (project main chat reuses this).
-- Mirrors ListTeamChatMessagesPage but keys on chat_session_id directly so a
-- team that hosts multiple project main chats doesn't merge them.
SELECT cm.*
FROM chat_message cm
WHERE cm.chat_session_id = sqlc.arg('chat_session_id')
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

-- name: GetChatMessage :one
SELECT * FROM chat_message
WHERE id = $1;

-- name: CreateChatTask :one
INSERT INTO agent_task_queue (agent_id, runtime_id, issue_id, status, priority, chat_session_id, context, force_fresh_session)
VALUES ($1, $2, NULL, 'queued', $3, $4, sqlc.narg('context'), COALESCE(sqlc.narg('force_fresh_session')::boolean, FALSE))
RETURNING *;

-- name: GetLastChatTaskSession :one
-- Returns the most recent task in this chat session that managed to record a
-- session_id. Includes both completed and failed tasks: even a failed task
-- may have established a real agent session before failing, and we'd rather
-- resume there than start over and lose conversation memory. Used as a
-- fallback when chat_session.session_id is NULL.
SELECT session_id, work_dir FROM agent_task_queue
WHERE chat_session_id = $1
  AND status IN ('completed', 'failed')
  AND session_id IS NOT NULL
ORDER BY completed_at DESC
LIMIT 1;

-- name: GetPendingChatTask :one
-- Returns the most recent in-flight task for a chat session, if any.
-- Used by the frontend to recover pending state after refresh / reopen.
-- created_at is the anchor for the chat StatusPill timer (it computes
-- elapsed = now - task.created_at), so the pill survives refresh / reopen
-- without "resetting to 0s".
SELECT id, status, created_at FROM agent_task_queue
WHERE chat_session_id = $1 AND status IN ('queued', 'dispatched', 'running')
ORDER BY created_at DESC
LIMIT 1;

-- name: ListPendingChatTasksByCreator :many
-- Aggregate view of all in-flight chat tasks owned by a given creator in a
-- workspace. Drives the FAB's "running" indicator when the chat window is
-- closed and no single session's query is active.
-- 客厅内部虚拟 session 不纳入 FAB 指示器。
SELECT atq.id AS task_id, atq.status, atq.chat_session_id
FROM agent_task_queue atq
JOIN chat_session cs ON cs.id = atq.chat_session_id
WHERE cs.workspace_id = $1
  AND cs.creator_id = $2
  AND cs.team_id IS NULL
  AND cs.is_room_internal = FALSE
  AND atq.status IN ('queued', 'dispatched', 'running')
ORDER BY atq.created_at DESC;

-- name: MarkChatSessionRead :exec
-- Clears unread_since, dropping the session's unread count to 0.
UPDATE chat_session SET unread_since = NULL
WHERE id = $1;

-- name: SetUnreadSinceIfNull :exec
-- Atomically stamps the first unread assistant message's arrival time.
-- No-op if the session is already in "has unread" state — keeps the earliest
-- unread boundary stable across multiple incoming replies.
UPDATE chat_session SET unread_since = now()
WHERE id = $1 AND unread_since IS NULL;

-- name: CreateRoomInternalChatSession :one
-- 创建客厅内部 ephemeral session。is_room_internal=TRUE，不出现在 sidebar 列表。
INSERT INTO chat_session (workspace_id, agent_id, creator_id, title, room_id, is_room_internal)
VALUES ($1, $2, $3, $4, $5, TRUE)
RETURNING *;

-- name: GetRoomInternalChatSession :one
-- 通过 (room_id, agent_id) 找到已存在的客厅内部 active session
SELECT * FROM chat_session
WHERE room_id = $1 AND agent_id = $2 AND is_room_internal = TRUE AND status = 'active'
ORDER BY created_at DESC
LIMIT 1;
