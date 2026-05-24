DROP INDEX IF EXISTS idx_meeting_transcript_meeting_active_seq;

ALTER TABLE meeting_transcript_segment
    DROP COLUMN IF EXISTS edit_revision,
    DROP COLUMN IF EXISTS deleted_by_user_id,
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS updated_at;
