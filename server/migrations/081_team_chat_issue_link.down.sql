DROP INDEX IF EXISTS idx_issue_source_team_session;
DROP INDEX IF EXISTS idx_issue_source_team_message;

ALTER TABLE issue DROP COLUMN IF EXISTS source_team_session_id;
ALTER TABLE issue DROP COLUMN IF EXISTS source_team_message_id;
