-- Origin AI Roundtable P0 — let a Mission remember which Council it came from.
--
-- The "convert roundtable to Mission" flow needs a reverse pointer so the
-- Mission detail page can link back to the source roundtable for context
-- recovery, and so analytics can answer "how many Missions started as a
-- decision roundtable vs. ad-hoc?".
--
-- ON DELETE SET NULL: deleting a council should not cascade-delete the
-- mission it spawned — the Mission is the durable artifact.

ALTER TABLE mission
    ADD COLUMN source_council_id UUID
        REFERENCES council_session(id) ON DELETE SET NULL;

CREATE INDEX idx_mission_source_council
    ON mission(source_council_id)
    WHERE source_council_id IS NOT NULL;
