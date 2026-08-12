-- 094 down: Revert to 4-subject CHECK constraint (remove project_id from CHECK).
-- Note: project_id column stays (it was added by 080), only the constraint reverts.

DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'tool_binding'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%project_id%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE tool_binding DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE tool_binding
    ADD CONSTRAINT tool_binding_single_subject CHECK (
        (mission_id IS NOT NULL)::int +
        (agent_id IS NOT NULL)::int +
        (idea_id IS NOT NULL)::int +
        (council_session_id IS NOT NULL)::int = 1
    );
