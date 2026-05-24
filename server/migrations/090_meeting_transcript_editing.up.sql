ALTER TABLE meeting_transcript_segment
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by_user_id UUID REFERENCES "user"(id) ON DELETE SET NULL,
    ADD COLUMN edit_revision INT NOT NULL DEFAULT 0;

CREATE INDEX idx_meeting_transcript_meeting_active_seq
    ON meeting_transcript_segment(meeting_id, seq)
    WHERE deleted_at IS NULL;
