-- 082_project_main_chat: 让 chat_session 同时按 (team_id, project_id) 唯一
--
-- v1.1：每个 team 最多 1 个 chat_session（069 的 partial unique index）
-- v1.2：team 1:N project 1:1 chat_session —— 一个 team 名下每个项目各一条
--       chat_session（项目主聊），team_id 自身不再唯一
--
-- 本迁移：
--   1. 删除 069 留下的 (team_id) 唯一约束
--   2. 新建 (team_id, project_id) 复合唯一（NULLS NOT DISTINCT，PG15+），
--      让 project_id 为 NULL 也能命中 ON CONFLICT，向后兼容老的 team-only chat
--   3. 给 project 表加 main_chat_session_id（项目主聊锚点，可空，
--      project 创建后由 EnsureProjectMainChatSession 写入）

DROP INDEX IF EXISTS idx_chat_session_team_unique;

CREATE UNIQUE INDEX idx_chat_session_team_project_unique
ON chat_session (team_id, project_id) NULLS NOT DISTINCT
WHERE team_id IS NOT NULL;

ALTER TABLE project
    ADD COLUMN main_chat_session_id UUID REFERENCES chat_session(id) ON DELETE SET NULL;

CREATE INDEX idx_project_main_chat ON project(main_chat_session_id) WHERE main_chat_session_id IS NOT NULL;
