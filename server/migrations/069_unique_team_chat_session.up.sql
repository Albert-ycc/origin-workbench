-- A team must have exactly one group chat session at most.
-- Migration 068 introduced chat_session.team_id but only enforced the
-- agent/team XOR shape; this unique partial index makes the lazy
-- GetOrCreateTeamChatSession path safe under concurrent first messages.

CREATE UNIQUE INDEX idx_chat_session_team_unique
ON chat_session(team_id)
WHERE team_id IS NOT NULL;
