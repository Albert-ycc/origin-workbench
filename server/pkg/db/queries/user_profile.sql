-- =====================
-- UserProfile (Origin §14.10)
-- =====================

-- name: GetUserProfile :one
SELECT * FROM user_profile
WHERE workspace_id = $1 AND user_id = $2;

-- name: UpsertUserProfile :one
INSERT INTO user_profile (
    workspace_id, user_id,
    role_card, communication_style, presence, preferences_source_path
) VALUES (
    $1, $2, $3, $4, $5, $6
)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET
    role_card = EXCLUDED.role_card,
    communication_style = EXCLUDED.communication_style,
    presence = EXCLUDED.presence,
    preferences_source_path = EXCLUDED.preferences_source_path,
    updated_at = now()
RETURNING *;

-- name: DeleteUserProfile :exec
DELETE FROM user_profile WHERE workspace_id = $1 AND user_id = $2;
