-- Origin Idea Pool (想法池): 轻量孵化层，位于 Direct Chat 与 Mission 之间。
-- Idea 用于"还没想清楚要不要做"的零散想法，养护成熟后一键升级为 Mission。
-- 与 Mission 不同：Idea 没有任务树、不能直接派 Delegation、养护是低风险只读操作。

CREATE TABLE idea (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    nurturer_agent_id UUID REFERENCES agent(id) ON DELETE SET NULL,
    promoted_mission_id UUID REFERENCES mission(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'from_chat', 'from_external')),
    source_ref TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'nurturing'
        CHECK (status IN ('draft', 'nurturing', 'promoted', 'archived')),
    tags TEXT[] NOT NULL DEFAULT '{}',
    last_nurtured_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_idea_workspace_status_updated ON idea(workspace_id, status, updated_at DESC);
CREATE INDEX idx_idea_workspace_nurtured ON idea(workspace_id, last_nurtured_at DESC NULLS LAST)
    WHERE status = 'nurturing';
CREATE INDEX idx_idea_nurturer ON idea(nurturer_agent_id)
    WHERE nurturer_agent_id IS NOT NULL;

CREATE TABLE idea_nurture_note (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id UUID NOT NULL REFERENCES idea(id) ON DELETE CASCADE,
    author_agent_id UUID REFERENCES agent(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'new_angle'
        CHECK (kind IN ('new_angle', 'related_history', 'external_reference', 'question')),
    summary TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    references_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_idea_nurture_note_idea_created ON idea_nurture_note(idea_id, created_at DESC);
