ALTER TABLE agent_memory
    ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed',
    ADD COLUMN confirmed_at TIMESTAMPTZ,
    ADD COLUMN confirmed_by_user_id UUID REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE agent_memory
    ADD CONSTRAINT agent_memory_status_check
    CHECK (status IN ('candidate', 'confirmed', 'rejected'));

UPDATE agent_memory
SET status = 'confirmed',
    confirmed_at = COALESCE(confirmed_at, created_at)
WHERE status = 'confirmed';

CREATE INDEX idx_agent_memory_status_created
    ON agent_memory(workspace_id, agent_id, status, created_at DESC);
