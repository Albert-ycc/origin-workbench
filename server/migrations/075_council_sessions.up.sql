-- Origin Council Session (会议室): 临时召集多个 Agent 进入同一上下文讨论决策。
-- 与 Mission 不同：CouncilSession 是按需召开的会议实例，不是骨架性工作对象。
-- 与 chat_session 不同：CouncilSession 有显式参会者、活跃度档位、散会结论等会议
-- 元数据，承载的消息可挂在 source_chat_session 也可未来独立承载（Phase 1 仅建对象）。

CREATE TABLE council_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    convener_user_id UUID REFERENCES "user"(id) ON DELETE SET NULL,
    convener_agent_id UUID REFERENCES agent(id) ON DELETE SET NULL,
    related_mission_id UUID REFERENCES mission(id) ON DELETE SET NULL,
    related_idea_id UUID REFERENCES idea(id) ON DELETE SET NULL,
    source_chat_session_id UUID REFERENCES chat_session(id) ON DELETE SET NULL,
    topic TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    activity_level TEXT NOT NULL DEFAULT 'concise'
        CHECK (activity_level IN ('quiet', 'concise', 'lively')),
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'adjourned', 'archived')),
    conclusion TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A council must have at least a human convener or an agent convener
    CHECK (convener_user_id IS NOT NULL OR convener_agent_id IS NOT NULL)
);

CREATE INDEX idx_council_session_workspace_status_updated
    ON council_session(workspace_id, status, updated_at DESC);
CREATE INDEX idx_council_session_mission ON council_session(related_mission_id)
    WHERE related_mission_id IS NOT NULL;
CREATE INDEX idx_council_session_idea ON council_session(related_idea_id)
    WHERE related_idea_id IS NOT NULL;

CREATE TABLE council_session_participant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES council_session(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('convener', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at TIMESTAMPTZ,
    UNIQUE (session_id, agent_id)
);

CREATE INDEX idx_council_session_participant_session
    ON council_session_participant(session_id, joined_at ASC);
CREATE INDEX idx_council_session_participant_agent
    ON council_session_participant(agent_id, joined_at DESC);
