ALTER TABLE meeting_audio_asset
    ADD CONSTRAINT meeting_audio_asset_scope_unique
    UNIQUE (id, meeting_id, workspace_id, project_id);

CREATE TABLE meeting_asr_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    meeting_id UUID NOT NULL,
    audio_asset_id UUID NOT NULL,
    provider TEXT NOT NULL DEFAULT 'local'
        CHECK (provider IN ('local', 'external', 'noop')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    error_message TEXT NOT NULL DEFAULT '',
    retry_count INT NOT NULL DEFAULT 0,
    source_seq_start INT,
    source_seq_end INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meeting_asr_job_session_fk
        FOREIGN KEY (meeting_id, workspace_id, project_id)
        REFERENCES meeting_session(id, workspace_id, project_id)
        ON DELETE CASCADE,
    CONSTRAINT meeting_asr_job_audio_asset_fk
        FOREIGN KEY (audio_asset_id, meeting_id, workspace_id, project_id)
        REFERENCES meeting_audio_asset(id, meeting_id, workspace_id, project_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_meeting_asr_job_meeting_created
    ON meeting_asr_job(meeting_id, created_at DESC);

CREATE INDEX idx_meeting_asr_job_audio_asset
    ON meeting_asr_job(audio_asset_id, created_at DESC);
