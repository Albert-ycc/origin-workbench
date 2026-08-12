-- 094: Extend tool_binding CHECK constraint from 4-subject to 5-subject.
--
-- The project_id column was already added by 080_v12_project_layer but the
-- CHECK constraint still only accepts mission/agent/idea/council. This
-- migration adds project_id as the fifth valid subject.
--
-- A binding lives under exactly one of: mission / agent / idea / council / project.

DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'tool_binding'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%mission_id%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE tool_binding DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE tool_binding
    ADD CONSTRAINT tool_binding_single_subject CHECK (
        (mission_id IS NOT NULL)::int +
        (agent_id IS NOT NULL)::int +
        (idea_id IS NOT NULL)::int +
        (council_session_id IS NOT NULL)::int +
        (project_id IS NOT NULL)::int = 1
    );
