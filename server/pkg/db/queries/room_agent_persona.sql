-- =====================
-- Room Agent Persona
-- =====================

-- name: GetRoomAgentPersona :one
SELECT * FROM room_agent_persona
WHERE room_id = $1 AND agent_id = $2;

-- name: UpsertRoomAgentPersona :one
INSERT INTO room_agent_persona (room_id, agent_id, persona_override)
VALUES ($1, $2, $3)
ON CONFLICT (room_id, agent_id) DO UPDATE
    SET persona_override = EXCLUDED.persona_override,
        updated_at = now()
RETURNING *;

-- name: DeleteRoomAgentPersona :exec
DELETE FROM room_agent_persona WHERE room_id = $1 AND agent_id = $2;

-- name: ListRoomAgentPersonas :many
SELECT * FROM room_agent_persona
WHERE room_id = $1
ORDER BY created_at ASC;
