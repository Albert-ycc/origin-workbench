-- 080_v12_project_layer: 引入项目工作区与团队层级（PRD §17, v1.2）
--
-- 重点：
--   1. 扩展 v1.0 留下的 project 表为「项目工作区」语义（绑团队 + 本地目录 + 记忆文档）
--   2. 新建 agent_project_memory（每个 Agent 在每个项目的视角记忆）
--   3. 给 mission/idea/exploration/tool_binding/mailbox_item/chat_session 加 project_id
--   4. 给 chat_session 加压缩相关字段（last_compacted_at/compacted_into_session_id/archived 状态）
--   5. 按 PRD §17.7 用户授权：清空旧 v1.1 数据（mission/idea/exploration/tool_binding/mailbox_item/council_session）；
--      agent 池 + team 表保留升级语义。

-- ============================================================
-- 1. project 表语义升级（v1.0 → v1.2）
-- ============================================================
ALTER TABLE project
    ADD COLUMN team_id UUID REFERENCES team(id) ON DELETE SET NULL,
    ADD COLUMN local_dir TEXT NOT NULL DEFAULT '',
    ADD COLUMN memory_doc TEXT NOT NULL DEFAULT '',
    ADD COLUMN memory_doc_updated_at TIMESTAMPTZ,
    ADD COLUMN compaction_count INT NOT NULL DEFAULT 0;

-- 旧 v1.0 status 'planned' 映射到 v1.2 的 'active'（v1.2 状态机：active/paused/completed/archived）
ALTER TABLE project
    DROP CONSTRAINT IF EXISTS project_status_check;
ALTER TABLE project
    ADD CONSTRAINT project_status_check CHECK (status IN ('active', 'paused', 'completed', 'archived', 'planned', 'in_progress', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_project_team ON project(team_id);
CREATE INDEX IF NOT EXISTS idx_project_workspace_status ON project(workspace_id, status);

-- ============================================================
-- 2. agent_project_memory（Agent 项目视角记忆）
-- ============================================================
CREATE TABLE agent_project_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    last_auto_compaction_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_id, project_id)
);
CREATE INDEX idx_agent_project_memory_project ON agent_project_memory(project_id);

-- ============================================================
-- 3. 关联表加 project_id
-- ============================================================
ALTER TABLE mission
    ADD COLUMN project_id UUID REFERENCES project(id) ON DELETE CASCADE;
CREATE INDEX idx_mission_project ON mission(project_id);

ALTER TABLE idea
    ADD COLUMN project_id UUID REFERENCES project(id) ON DELETE SET NULL;
CREATE INDEX idx_idea_project ON idea(project_id);

ALTER TABLE exploration
    ADD COLUMN project_id UUID REFERENCES project(id) ON DELETE CASCADE;
CREATE INDEX idx_exploration_project ON exploration(project_id);

ALTER TABLE tool_binding
    ADD COLUMN project_id UUID REFERENCES project(id) ON DELETE CASCADE;
CREATE INDEX idx_tool_binding_project ON tool_binding(project_id);

ALTER TABLE mailbox_item
    ADD COLUMN project_id UUID REFERENCES project(id) ON DELETE CASCADE;
CREATE INDEX idx_mailbox_item_project ON mailbox_item(project_id);

ALTER TABLE chat_session
    ADD COLUMN project_id UUID REFERENCES project(id) ON DELETE CASCADE;
CREATE INDEX idx_chat_session_project ON chat_session(project_id);

ALTER TABLE council_session
    ADD COLUMN project_id UUID REFERENCES project(id) ON DELETE SET NULL;
CREATE INDEX idx_council_session_project ON council_session(project_id);

-- ============================================================
-- 4. chat_session 压缩字段（§17.4.5 主聊压缩）
-- ============================================================
ALTER TABLE chat_session
    ADD COLUMN last_compacted_at TIMESTAMPTZ,
    ADD COLUMN compacted_into_session_id UUID REFERENCES chat_session(id) ON DELETE SET NULL;

-- chat_session.status 已有定义（active/archived），如果没有则新加
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'chat_session' AND column_name = 'status'
    ) THEN
        ALTER TABLE chat_session ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'archived'));
    END IF;
END $$;

-- ============================================================
-- 5. 清空 v1.1 数据（PRD §17.7，用户授权）
--    保留：agent / team / team_member / chat_session（仅清 message） / workspace / user
-- ============================================================
TRUNCATE TABLE
    mission_assignment,
    mission_event,
    mission_plan_item,
    mission,
    idea_nurture_note,
    idea,
    exploration_branch,
    exploration,
    tool_binding,
    mailbox_item
CASCADE;

-- council_session_participant 跟着 council_session 走 CASCADE
TRUNCATE TABLE council_session CASCADE;
