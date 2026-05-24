CREATE TABLE meeting_summary_chunk (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    meeting_id UUID NOT NULL,
    chunk_index INT NOT NULL,
    source_seq_start INT NOT NULL,
    source_seq_end INT NOT NULL,
    summary_md TEXT NOT NULL DEFAULT '',
    decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    risks JSONB NOT NULL DEFAULT '[]'::jsonb,
    feedback JSONB NOT NULL DEFAULT '[]'::jsonb,
    tensions JSONB NOT NULL DEFAULT '[]'::jsonb,
    action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    memory_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meeting_summary_chunk_session_fk
        FOREIGN KEY (meeting_id, workspace_id, project_id)
        REFERENCES meeting_session(id, workspace_id, project_id)
        ON DELETE CASCADE,
    CONSTRAINT meeting_summary_chunk_index_unique UNIQUE (meeting_id, chunk_index)
);

CREATE INDEX idx_meeting_summary_chunk_meeting_index
    ON meeting_summary_chunk(meeting_id, chunk_index);
