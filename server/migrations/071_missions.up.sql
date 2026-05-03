-- Origin missions: product-level work objects above the legacy issue/task
-- execution layer. A mission binds a user goal to an agent team, a captain,
-- a shared room, a plan tree, and execution/memory events.

CREATE TABLE mission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE RESTRICT,
    captain_agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE RESTRICT,
    chat_session_id UUID REFERENCES chat_session(id) ON DELETE SET NULL,
    created_by_user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planning'
        CHECK (status IN ('draft', 'planning', 'waiting_confirmation', 'executing', 'blocked', 'completed', 'archived')),
    risk_level TEXT NOT NULL DEFAULT 'low'
        CHECK (risk_level IN ('low', 'medium', 'high')),
    execution_mode TEXT NOT NULL DEFAULT 'auto'
        CHECK (execution_mode IN ('auto', 'confirm', 'step_confirm')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mission_workspace_updated ON mission(workspace_id, updated_at DESC)
    WHERE status <> 'archived';
CREATE INDEX idx_mission_team ON mission(team_id);
CREATE INDEX idx_mission_captain ON mission(captain_agent_id);

CREATE TABLE mission_plan_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES mission_plan_item(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    phase TEXT NOT NULL DEFAULT 'execute'
        CHECK (phase IN ('plan', 'execute', 'verify', 'ship')),
    status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('high', 'medium', 'low')),
    risk_level TEXT NOT NULL DEFAULT 'low'
        CHECK (risk_level IN ('low', 'medium', 'high')),
    assigned_agent_id UUID REFERENCES agent(id) ON DELETE SET NULL,
    issue_id UUID REFERENCES issue(id) ON DELETE SET NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mission_plan_item_mission ON mission_plan_item(mission_id, sort_order ASC);
CREATE INDEX idx_mission_plan_item_agent ON mission_plan_item(assigned_agent_id)
    WHERE assigned_agent_id IS NOT NULL;

CREATE TABLE mission_assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
    plan_item_id UUID REFERENCES mission_plan_item(id) ON DELETE SET NULL,
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'dispatched', 'running', 'waiting_confirmation', 'blocked', 'completed', 'failed', 'cancelled')),
    risk_level TEXT NOT NULL DEFAULT 'low'
        CHECK (risk_level IN ('low', 'medium', 'high')),
    task_id UUID REFERENCES agent_task_queue(id) ON DELETE SET NULL,
    issue_id UUID REFERENCES issue(id) ON DELETE SET NULL,
    output TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mission_assignment_mission ON mission_assignment(mission_id, created_at ASC);
CREATE INDEX idx_mission_assignment_agent ON mission_assignment(agent_id, created_at DESC);
CREATE INDEX idx_mission_assignment_task ON mission_assignment(task_id)
    WHERE task_id IS NOT NULL;

CREATE TABLE mission_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL DEFAULT 'system'
        CHECK (actor_type IN ('member', 'agent', 'system')),
    actor_id UUID,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mission_event_mission_created ON mission_event(mission_id, created_at ASC);
CREATE INDEX idx_mission_event_workspace_created ON mission_event(workspace_id, created_at DESC);
