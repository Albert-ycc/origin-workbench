DROP INDEX IF EXISTS idx_chat_session_team_project_unique;

CREATE UNIQUE INDEX idx_chat_session_team_project_unique
ON chat_session (team_id, project_id) NULLS NOT DISTINCT
WHERE team_id IS NOT NULL;
