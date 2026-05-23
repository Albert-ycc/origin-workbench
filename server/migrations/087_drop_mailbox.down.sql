-- Restore the deprecated mailbox mode for rollback only.

ALTER TABLE agent
    ADD COLUMN IF NOT EXISTS work_mode TEXT NOT NULL DEFAULT 'live'
        CHECK (work_mode IN ('live', 'mailbox')),
    ADD COLUMN IF NOT EXISTS mailbox_budget_seconds INT NOT NULL DEFAULT 3600,
    ADD COLUMN IF NOT EXISTS notify_policy TEXT NOT NULL DEFAULT 'both'
        CHECK (notify_policy IN ('on_complete', 'on_block', 'both'));

CREATE TABLE IF NOT EXISTS mailbox_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    chat_session_id UUID NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
    task_id UUID REFERENCES agent_task_queue(id) ON DELETE SET NULL,
    raw_user_message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'done', 'blocked', 'timeout')),
    result TEXT NOT NULL DEFAULT '',
    blocked_description TEXT NOT NULL DEFAULT '',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processing_started_at TIMESTAMPTZ,
    processing_finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    project_id UUID REFERENCES project(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mailbox_item_workspace_finished
    ON mailbox_item (workspace_id, processing_finished_at DESC)
    WHERE status IN ('done', 'blocked', 'timeout');

CREATE INDEX IF NOT EXISTS idx_mailbox_item_agent
    ON mailbox_item (agent_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_mailbox_item_chat_session
    ON mailbox_item (chat_session_id, submitted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_mailbox_item_task
    ON mailbox_item (task_id)
    WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mailbox_item_project
    ON mailbox_item(project_id);
