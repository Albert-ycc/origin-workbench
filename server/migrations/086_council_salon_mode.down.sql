ALTER TABLE council_session
    DROP COLUMN IF EXISTS mode,
    DROP COLUMN IF EXISTS max_turns;
