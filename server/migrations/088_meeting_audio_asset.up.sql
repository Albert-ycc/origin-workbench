CREATE TABLE meeting_audio_asset (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    meeting_id UUID NOT NULL,
    storage_key TEXT NOT NULL,
    file_url TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    duration_seconds INT,
    status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'failed', 'deleted')),
    created_by_user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meeting_audio_asset_session_fk
        FOREIGN KEY (meeting_id, workspace_id, project_id)
        REFERENCES meeting_session(id, workspace_id, project_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_meeting_audio_asset_meeting_created
    ON meeting_audio_asset(meeting_id, created_at DESC)
    WHERE status != 'deleted';
