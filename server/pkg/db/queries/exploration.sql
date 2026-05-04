-- =====================
-- Exploration CRUD
-- =====================

-- name: ListExplorations :many
SELECT * FROM exploration
WHERE workspace_id = $1
  AND status <> 'archived'
ORDER BY updated_at DESC;

-- name: ListArchivedExplorations :many
SELECT * FROM exploration
WHERE workspace_id = $1
  AND status = 'archived'
ORDER BY updated_at DESC;

-- name: GetExplorationInWorkspace :one
SELECT * FROM exploration
WHERE id = $1 AND workspace_id = $2;

-- name: CreateExploration :one
INSERT INTO exploration (
    workspace_id, created_by_user_id,
    related_mission_id, related_idea_id,
    topic, question, status
) VALUES (
    $1, $2,
    sqlc.narg('related_mission_id')::uuid,
    sqlc.narg('related_idea_id')::uuid,
    $3, $4, $5
)
RETURNING *;

-- name: UpdateExploration :one
UPDATE exploration SET
    topic = COALESCE(sqlc.narg('topic'), topic),
    question = COALESCE(sqlc.narg('question'), question),
    status = COALESCE(sqlc.narg('status'), status),
    decision = COALESCE(sqlc.narg('decision'), decision),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ArchiveExploration :one
UPDATE exploration SET status = 'archived', updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteExploration :exec
DELETE FROM exploration WHERE id = $1;

-- =====================
-- Exploration Branch CRUD
-- =====================

-- name: ListExplorationBranches :many
SELECT * FROM exploration_branch
WHERE exploration_id = $1
ORDER BY sort_order ASC, created_at ASC;

-- name: GetExplorationBranchInExploration :one
SELECT * FROM exploration_branch
WHERE id = $1 AND exploration_id = $2;

-- name: CreateExplorationBranch :one
INSERT INTO exploration_branch (
    exploration_id, agent_id, title,
    core_proposal, design_logic, key_decisions,
    cost_estimate, risk_points, fits, does_not_fit,
    sort_order
) VALUES (
    $1, sqlc.narg('agent_id')::uuid, $2,
    $3, $4, $5,
    $6, $7, $8, $9,
    $10
)
RETURNING *;

-- name: UpdateExplorationBranch :one
UPDATE exploration_branch SET
    title = COALESCE(sqlc.narg('title'), title),
    core_proposal = COALESCE(sqlc.narg('core_proposal'), core_proposal),
    design_logic = COALESCE(sqlc.narg('design_logic'), design_logic),
    key_decisions = COALESCE(sqlc.narg('key_decisions'), key_decisions),
    cost_estimate = COALESCE(sqlc.narg('cost_estimate'), cost_estimate),
    risk_points = COALESCE(sqlc.narg('risk_points'), risk_points),
    fits = COALESCE(sqlc.narg('fits'), fits),
    does_not_fit = COALESCE(sqlc.narg('does_not_fit'), does_not_fit),
    verdict = COALESCE(sqlc.narg('verdict'), verdict),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteExplorationBranchInExploration :one
DELETE FROM exploration_branch
WHERE id = $1 AND exploration_id = $2
RETURNING id;

-- name: ResetExplorationBranchVerdicts :exec
-- Used when re-opening an exploration: clear all verdicts to pending so the
-- user can re-pick after new evidence arrives.
UPDATE exploration_branch SET verdict = 'pending', updated_at = now()
WHERE exploration_id = $1;
