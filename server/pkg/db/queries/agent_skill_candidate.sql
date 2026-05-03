-- name: ListAgentSkillCandidates :many
SELECT * FROM agent_skill_candidate
WHERE workspace_id = $1
  AND agent_id = $2
  AND status = ANY(sqlc.arg('statuses')::text[])
ORDER BY updated_at DESC, created_at DESC
LIMIT $3;

-- name: CreateAgentSkillCandidate :one
INSERT INTO agent_skill_candidate (
    workspace_id, agent_id, name, description, content, config, ref_type, ref_id, status
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, sqlc.narg('ref_id'), $8
)
RETURNING *;

-- name: GetAgentSkillCandidateInWorkspace :one
SELECT * FROM agent_skill_candidate
WHERE id = $1
  AND workspace_id = $2
  AND agent_id = $3;

-- name: ConfirmAgentSkillCandidate :one
UPDATE agent_skill_candidate SET
    status = 'confirmed',
    skill_id = $4,
    confirmed_at = now(),
    confirmed_by_user_id = sqlc.narg('confirmed_by_user_id'),
    updated_at = now()
WHERE id = $1
  AND workspace_id = $2
  AND agent_id = $3
  AND status = 'candidate'
RETURNING *;

-- name: RejectAgentSkillCandidate :one
UPDATE agent_skill_candidate SET
    status = 'rejected',
    updated_at = now()
WHERE id = $1
  AND workspace_id = $2
  AND agent_id = $3
  AND status = 'candidate'
RETURNING *;
