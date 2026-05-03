DROP INDEX IF EXISTS idx_agent_memory_status_created;

ALTER TABLE agent_memory
    DROP CONSTRAINT IF EXISTS agent_memory_status_check;

ALTER TABLE agent_memory
    DROP COLUMN IF EXISTS confirmed_by_user_id,
    DROP COLUMN IF EXISTS confirmed_at,
    DROP COLUMN IF EXISTS status;
