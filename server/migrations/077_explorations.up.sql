-- Origin §14.7 — Branching Exploration: hold multiple solution paths under
-- the same question, force every branch to fill the same seven fields so
-- they can be compared row-for-row, then mark a winning branch when the
-- user converges. Sandbox scheduling for parallel agents lands in Phase 6;
-- this migration only delivers the data backbone and the 7-field contract.

CREATE TABLE exploration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    related_mission_id UUID REFERENCES mission(id) ON DELETE SET NULL,
    related_idea_id UUID REFERENCES idea(id) ON DELETE SET NULL,
    topic TEXT NOT NULL,
    question TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'converging', 'closed', 'archived')),
    decision TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exploration_workspace_status_updated
    ON exploration(workspace_id, status, updated_at DESC);
CREATE INDEX idx_exploration_mission ON exploration(related_mission_id)
    WHERE related_mission_id IS NOT NULL;
CREATE INDEX idx_exploration_idea ON exploration(related_idea_id)
    WHERE related_idea_id IS NOT NULL;

CREATE TABLE exploration_branch (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exploration_id UUID NOT NULL REFERENCES exploration(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agent(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    -- PRD §14.7 seven-field contract — every branch must fill these so the
    -- compare panel can render them as a single uniform table.
    core_proposal TEXT NOT NULL DEFAULT '',
    design_logic TEXT NOT NULL DEFAULT '',
    key_decisions TEXT NOT NULL DEFAULT '',
    cost_estimate TEXT NOT NULL DEFAULT '',
    risk_points TEXT NOT NULL DEFAULT '',
    fits TEXT NOT NULL DEFAULT '',
    does_not_fit TEXT NOT NULL DEFAULT '',
    verdict TEXT NOT NULL DEFAULT 'pending'
        CHECK (verdict IN ('pending', 'winning', 'runner_up', 'discarded')),
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exploration_branch_exploration
    ON exploration_branch(exploration_id, sort_order ASC, created_at ASC);
