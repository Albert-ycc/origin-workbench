-- 083_chat_session_unique_active_only：让 (team_id, project_id) 唯一约束
-- 只对 status = 'active' 生效，归档的旧主聊不再占用 unique 槽。
--
-- 背景：v1.2 §17.4.5 主聊压缩流程会归档旧 chat_session 并新建一条新
-- session（同 team_id + project_id），如果 unique 约束不区分 status，
-- 第二次 GetOrCreate 会命中 ON CONFLICT 返回旧的 archived row，无法
-- 真正建新主聊。

DROP INDEX IF EXISTS idx_chat_session_team_project_unique;

CREATE UNIQUE INDEX idx_chat_session_team_project_unique
ON chat_session (team_id, project_id) NULLS NOT DISTINCT
WHERE team_id IS NOT NULL AND status = 'active';
