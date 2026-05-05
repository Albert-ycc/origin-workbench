-- 082_project_main_chat down：回滚到 069 的 (team_id) 唯一形态。
-- 注意：如果当前已有 team 名下多条 chat_session（按 project_id 区分），
-- 直接回滚会触发 unique 冲突；下游使用前请先归档多余 chat_session。

DROP INDEX IF EXISTS idx_project_main_chat;
ALTER TABLE project DROP COLUMN IF EXISTS main_chat_session_id;

DROP INDEX IF EXISTS idx_chat_session_team_project_unique;

CREATE UNIQUE INDEX idx_chat_session_team_unique
ON chat_session(team_id)
WHERE team_id IS NOT NULL;
