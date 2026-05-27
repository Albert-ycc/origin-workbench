-- =====================
-- Mission CRUD
-- =====================

-- name: ListMissions :many
SELECT * FROM mission
WHERE workspace_id = $1
  AND (sqlc.narg('project_id')::uuid IS NULL OR project_id = sqlc.narg('project_id')::uuid)
  AND status <> 'archived'
ORDER BY updated_at DESC;

-- name: ListArchivedMissions :many
SELECT * FROM mission
WHERE workspace_id = $1
  AND (sqlc.narg('project_id')::uuid IS NULL OR project_id = sqlc.narg('project_id')::uuid)
  AND status = 'archived'
ORDER BY updated_at DESC;

-- name: GetMissionInWorkspace :one
SELECT * FROM mission
WHERE id = $1 AND workspace_id = $2;

-- name: GetMissionByTask :one
SELECT m.*
FROM mission m
INNER JOIN mission_assignment ma ON ma.mission_id = m.id
WHERE ma.task_id = $1
ORDER BY ma.created_at DESC
LIMIT 1;

-- name: GetActiveMissionByTeamChatSession :one
SELECT * FROM mission
WHERE team_id = $1
  AND chat_session_id = $2
  AND status IN ('planning', 'waiting_confirmation', 'executing', 'blocked')
ORDER BY updated_at DESC
LIMIT 1;

-- name: CreateMission :one
INSERT INTO mission (
    workspace_id, team_id, captain_agent_id, chat_session_id, created_by_user_id,
    title, prompt, summary, outcome, status, risk_level, execution_mode, project_id,
    source_council_id
) VALUES (
    $1, $2, $3, sqlc.narg('chat_session_id'), $4,
    $5, $6, $7, $8, $9, $10, $11, sqlc.narg('project_id')::uuid,
    sqlc.narg('source_council_id')::uuid
)
RETURNING *;

-- name: UpdateMission :one
UPDATE mission SET
    title = COALESCE(sqlc.narg('title'), title),
    summary = COALESCE(sqlc.narg('summary'), summary),
    outcome = COALESCE(sqlc.narg('outcome'), outcome),
    status = COALESCE(sqlc.narg('status'), status),
    risk_level = COALESCE(sqlc.narg('risk_level'), risk_level),
    execution_mode = COALESCE(sqlc.narg('execution_mode'), execution_mode),
    team_id = COALESCE(sqlc.narg('team_id')::uuid, team_id),
    captain_agent_id = COALESCE(sqlc.narg('captain_agent_id')::uuid, captain_agent_id),
    chat_session_id = COALESCE(sqlc.narg('chat_session_id')::uuid, chat_session_id),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateMissionByTask :exec
UPDATE mission SET
    status = $2,
    updated_at = now()
WHERE id = (
    SELECT mission_id
    FROM mission_assignment
    WHERE task_id = $1
    ORDER BY created_at DESC
    LIMIT 1
)
AND status <> 'archived';

-- name: ArchiveMission :one
UPDATE mission SET status = 'archived', updated_at = now()
WHERE id = $1
RETURNING *;

-- =====================
-- Mission plan
-- =====================

-- name: ListMissionPlanItems :many
SELECT * FROM mission_plan_item
WHERE mission_id = $1
ORDER BY sort_order ASC, created_at ASC;

-- name: CreateMissionPlanItem :one
INSERT INTO mission_plan_item (
    mission_id, parent_id, title, description, phase, status, priority,
    risk_level, assigned_agent_id, issue_id, sort_order
) VALUES (
    $1, sqlc.narg('parent_id'), $2, $3, $4, $5, $6,
    $7, sqlc.narg('assigned_agent_id'), sqlc.narg('issue_id'), $8
)
RETURNING *;

-- name: UpdateMissionPlanItem :one
UPDATE mission_plan_item SET
    title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    phase = COALESCE(sqlc.narg('phase'), phase),
    status = COALESCE(sqlc.narg('status'), status),
    priority = COALESCE(sqlc.narg('priority'), priority),
    risk_level = COALESCE(sqlc.narg('risk_level'), risk_level),
    assigned_agent_id = COALESCE(sqlc.narg('assigned_agent_id')::uuid, assigned_agent_id),
    issue_id = COALESCE(sqlc.narg('issue_id')::uuid, issue_id),
    sort_order = COALESCE(sqlc.narg('sort_order')::int, sort_order),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateMissionPlanItemByTask :exec
UPDATE mission_plan_item SET
    status = $2,
    updated_at = now()
WHERE id = (
    SELECT plan_item_id
    FROM mission_assignment
    WHERE task_id = $1
      AND plan_item_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
);

-- =====================
-- Mission assignments
-- =====================

-- name: ListMissionAssignments :many
SELECT * FROM mission_assignment
WHERE mission_id = $1
ORDER BY created_at ASC;

-- name: GetMissionAssignmentByTask :one
SELECT * FROM mission_assignment
WHERE task_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: CreateMissionAssignment :one
INSERT INTO mission_assignment (
    mission_id, plan_item_id, agent_id, status, risk_level, task_id, issue_id, output
) VALUES (
    $1, sqlc.narg('plan_item_id'), $2, $3, $4,
    sqlc.narg('task_id'), sqlc.narg('issue_id'), $5
)
RETURNING *;

-- name: UpdateMissionAssignment :one
UPDATE mission_assignment SET
    status = COALESCE(sqlc.narg('status'), status),
    risk_level = COALESCE(sqlc.narg('risk_level'), risk_level),
    task_id = COALESCE(sqlc.narg('task_id')::uuid, task_id),
    issue_id = COALESCE(sqlc.narg('issue_id')::uuid, issue_id),
    output = COALESCE(sqlc.narg('output'), output),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateMissionAssignmentByTask :exec
UPDATE mission_assignment SET
    status = $2,
    output = COALESCE(sqlc.narg('output'), output),
    updated_at = now()
WHERE task_id = $1;

-- =====================
-- Mission events
-- =====================

-- name: ListMissionEvents :many
SELECT * FROM mission_event
WHERE mission_id = $1
ORDER BY created_at ASC;

-- name: CreateMissionEvent :one
INSERT INTO mission_event (
    mission_id, workspace_id, actor_type, actor_id, kind, title, body, payload
) VALUES (
    $1, $2, $3, sqlc.narg('actor_id'), $4, $5, $6, $7
)
RETURNING *;

-- name: CreateMissionEventForTask :exec
INSERT INTO mission_event (
    mission_id, workspace_id, actor_type, actor_id, kind, title, body, payload
)
SELECT
    ma.mission_id, m.workspace_id, $2, sqlc.narg('actor_id'), $3, $4, $5, $6
FROM mission_assignment ma
INNER JOIN mission m ON m.id = ma.mission_id
WHERE ma.task_id = $1
ORDER BY ma.created_at DESC
LIMIT 1;
