-- 079_mailbox: Agent.work_mode + mailbox_item queue
-- Implements PRD §14.8 (Agent work mode: live / mailbox).
--
-- The desktop dispatch path stays exactly as-is (agent_task_queue is already
-- async). What changes is how the user perceives the wait:
--   live    — chat window waits for chat:done WS, shows the assistant
--             bubble inline (existing v1.0 behaviour).
--   mailbox — chat window confirms "received, processing" and lets the user
--             leave; result/blocked-reason surface back through mailbox_item
--             plus the workbench inbox (PRD §15.2 block 6).
--
-- mailbox_item is a *user-facing report row*, not a second task queue.
-- Each row links to the underlying agent_task_queue task that actually
-- carries the work. Tasks remain the source of truth for execution; the
-- mailbox row tracks what to show the user about that work.

ALTER TABLE agent
    ADD COLUMN work_mode TEXT NOT NULL DEFAULT 'live'
        CHECK (work_mode IN ('live', 'mailbox')),
    ADD COLUMN mailbox_budget_seconds INT NOT NULL DEFAULT 3600,
    ADD COLUMN notify_policy TEXT NOT NULL DEFAULT 'both'
        CHECK (notify_policy IN ('on_complete', 'on_block', 'both'));

CREATE TABLE mailbox_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    chat_session_id UUID NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
    -- Task is the source of truth for execution. SET NULL on delete so the
    -- mailbox row survives task GC; we still need to show the user what
    -- happened even if the task row gets pruned later.
    task_id UUID REFERENCES agent_task_queue(id) ON DELETE SET NULL,
    raw_user_message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'done', 'blocked', 'timeout')),
    -- result / blocked_description are mutually exclusive in practice but the
    -- check would be too brittle (status flips happen across tx boundaries),
    -- so we just leave both nullable and rely on the worker to write the
    -- right one.
    result TEXT NOT NULL DEFAULT '',
    blocked_description TEXT NOT NULL DEFAULT '',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processing_started_at TIMESTAMPTZ,
    processing_finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Block 6 on workbench: list recent done/blocked items per workspace,
-- newest finished first. Partial index keeps the workbench query cheap
-- even if a single agent racks up thousands of completed items over time.
CREATE INDEX idx_mailbox_item_workspace_finished
    ON mailbox_item (workspace_id, processing_finished_at DESC)
    WHERE status IN ('done', 'blocked', 'timeout');

CREATE INDEX idx_mailbox_item_agent
    ON mailbox_item (agent_id, submitted_at DESC);

CREATE INDEX idx_mailbox_item_chat_session
    ON mailbox_item (chat_session_id, submitted_at DESC);

-- Single processing row per task — protects against double-write if the
-- dispatch path ever retries enqueue (each chat task corresponds to one
-- mailbox item). Partial unique to allow task_id IS NULL (post-cleanup) on
-- finished rows.
CREATE UNIQUE INDEX uniq_mailbox_item_task
    ON mailbox_item (task_id)
    WHERE task_id IS NOT NULL;
