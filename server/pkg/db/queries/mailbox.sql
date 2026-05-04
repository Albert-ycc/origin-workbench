-- name: CreateMailboxItem :one
INSERT INTO mailbox_item (
    workspace_id, agent_id, chat_session_id, task_id, raw_user_message,
    status, processing_started_at
)
VALUES ($1, $2, $3, sqlc.narg('task_id'), $4, 'processing', now())
RETURNING *;

-- name: GetMailboxItem :one
SELECT * FROM mailbox_item WHERE id = $1;

-- name: GetMailboxItemByTask :one
-- Look up the user-facing mailbox row for a given task id. Used by the task
-- complete/fail hook to flip processing → done / blocked.
SELECT * FROM mailbox_item WHERE task_id = $1;

-- name: ListMailboxItemsByWorkspace :many
-- Workbench block 6: most recently finished items the user hasn't seen.
-- Limit/offset are handled by the caller (defaults to 20 / 0). Ordered by
-- processing_finished_at DESC, NULLS LAST so still-processing items appear
-- after finished ones (block 6 cares about reports, not in-flight work).
SELECT * FROM mailbox_item
WHERE workspace_id = $1
ORDER BY processing_finished_at DESC NULLS LAST, submitted_at DESC
LIMIT $2 OFFSET $3;

-- name: ListMailboxItemsByAgent :many
SELECT * FROM mailbox_item
WHERE agent_id = $1
ORDER BY submitted_at DESC
LIMIT $2 OFFSET $3;

-- name: ListMailboxItemsByChatSession :many
SELECT * FROM mailbox_item
WHERE chat_session_id = $1
ORDER BY submitted_at ASC;

-- name: CountActiveMailboxItemsForAgent :one
-- Used to enforce PRD §14.8.4 limit ("queue cap 20"). Counts items still
-- in processing for a given agent.
SELECT COUNT(*) FROM mailbox_item
WHERE agent_id = $1 AND status = 'processing';

-- name: MarkMailboxItemDone :one
UPDATE mailbox_item
SET status = 'done',
    result = $2,
    processing_finished_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkMailboxItemBlocked :one
UPDATE mailbox_item
SET status = 'blocked',
    blocked_description = $2,
    processing_finished_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkMailboxItemTimeout :one
UPDATE mailbox_item
SET status = 'timeout',
    blocked_description = $2,
    processing_finished_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING *;
