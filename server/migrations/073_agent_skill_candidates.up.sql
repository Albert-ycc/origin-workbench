CREATE TABLE agent_skill_candidate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    config JSONB NOT NULL DEFAULT '{}',
    ref_type TEXT NOT NULL DEFAULT '',
    ref_id UUID,
    status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (status IN ('candidate', 'confirmed', 'rejected')),
    skill_id UUID REFERENCES skill(id) ON DELETE SET NULL,
    confirmed_at TIMESTAMPTZ,
    confirmed_by_user_id UUID REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_skill_candidate_agent_status
    ON agent_skill_candidate(workspace_id, agent_id, status, created_at DESC);

CREATE INDEX idx_agent_skill_candidate_ref
    ON agent_skill_candidate(ref_type, ref_id)
    WHERE ref_type <> '' AND ref_id IS NOT NULL;
