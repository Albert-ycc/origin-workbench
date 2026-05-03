-- Reverse Phase 2 teams migration.
-- Undo additive bits first; then DROP team_member / team last so the
-- chat_session FK is gone before we destroy referenced rows.

DROP INDEX IF EXISTS idx_chat_message_sender_agent;
ALTER TABLE chat_message DROP COLUMN IF EXISTS sender_agent_id;

-- Re-tighten chat_session.agent_id. Drop the xor CHECK first, drop team-only
-- rows (their agent_id is NULL), then reinstate NOT NULL.
ALTER TABLE chat_session DROP CONSTRAINT IF EXISTS chat_session_agent_xor_team;
DELETE FROM chat_session WHERE agent_id IS NULL;
DROP INDEX IF EXISTS idx_chat_session_team;
ALTER TABLE chat_session DROP COLUMN IF EXISTS team_id;
ALTER TABLE chat_session ALTER COLUMN agent_id SET NOT NULL;

DROP INDEX IF EXISTS idx_team_member_agent;
DROP TABLE IF EXISTS team_member;

DROP INDEX IF EXISTS idx_team_captain;
DROP INDEX IF EXISTS idx_team_workspace;
DROP TABLE IF EXISTS team;
