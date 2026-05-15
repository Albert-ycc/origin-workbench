-- 084_meeting_copilot: realtime meeting copilot foundation (PRD §18)
--
-- Scope:
--   1. Store meeting sessions under the v1.2 project workspace.
--   2. Store transcript segments submitted by the desktop renderer.
--   3. Store evidence-backed insight cards and summaries.
--   4. Enforce workspace/project isolation at the database layer.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'project_id_workspace_unique'
    ) THEN
        ALTER TABLE project
            ADD CONSTRAINT project_id_workspace_unique UNIQUE (id, workspace_id);
    END IF;
END $$;

CREATE TABLE meeting_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    title TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    user_role TEXT NOT NULL DEFAULT '',
    strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
    reminder_mode TEXT NOT NULL DEFAULT 'strong'
        CHECK (reminder_mode IN ('strong', 'review', 'quiet')),
    reminder_intensity TEXT NOT NULL DEFAULT 'standard'
        CHECK (reminder_intensity IN ('conservative', 'standard', 'aggressive')),
    sound_enabled BOOLEAN NOT NULL DEFAULT false,
    asr_provider TEXT NOT NULL DEFAULT 'renderer'
        CHECK (asr_provider IN ('renderer', 'local', 'external', 'manual')),
    model_source TEXT NOT NULL DEFAULT 'not_configured'
        CHECK (model_source IN ('not_configured', 'local', 'external')),
    analysis_status TEXT NOT NULL DEFAULT 'paused'
        CHECK (analysis_status IN ('idle', 'running', 'paused', 'failed', 'completed')),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'running', 'stopped', 'summarizing', 'completed', 'archived')),
    created_by_user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meeting_session_project_workspace_fk
        FOREIGN KEY (project_id, workspace_id)
        REFERENCES project(id, workspace_id)
        ON DELETE CASCADE,
    CONSTRAINT meeting_session_scope_unique UNIQUE (id, workspace_id, project_id)
);

CREATE INDEX idx_meeting_session_workspace_project
    ON meeting_session(workspace_id, project_id, updated_at DESC);
CREATE INDEX idx_meeting_session_workspace_status
    ON meeting_session(workspace_id, status, updated_at DESC);

CREATE TABLE meeting_transcript_segment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    meeting_id UUID NOT NULL,
    seq INT NOT NULL,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    speaker_label TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    audio_offset_ms INT,
    source TEXT NOT NULL DEFAULT 'renderer'
        CHECK (source IN ('renderer', 'local', 'external', 'manual')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meeting_transcript_session_fk
        FOREIGN KEY (meeting_id, workspace_id, project_id)
        REFERENCES meeting_session(id, workspace_id, project_id)
        ON DELETE CASCADE,
    CONSTRAINT meeting_transcript_seq_unique UNIQUE (meeting_id, seq)
);

CREATE INDEX idx_meeting_transcript_meeting_seq
    ON meeting_transcript_segment(meeting_id, seq);

CREATE TABLE meeting_insight_card (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    meeting_id UUID NOT NULL,
    type TEXT NOT NULL
        CHECK (type IN ('question', 'risk', 'feedback', 'tension', 'summary')),
    severity TEXT NOT NULL DEFAULT 'L1'
        CHECK (severity IN ('L1', 'L2', 'L3')),
    title TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    suggested_question TEXT NOT NULL DEFAULT '',
    evidence_quote TEXT NOT NULL DEFAULT '',
    evidence_segment_id UUID REFERENCES meeting_transcript_segment(id) ON DELETE SET NULL,
    evidence_start_ms INT,
    evidence_end_ms INT,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'asked', 'accepted', 'ignored', 'post_meeting', 'resolved')),
    dedupe_key TEXT,
    alerted_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meeting_insight_session_fk
        FOREIGN KEY (meeting_id, workspace_id, project_id)
        REFERENCES meeting_session(id, workspace_id, project_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_meeting_insight_meeting_status
    ON meeting_insight_card(meeting_id, status, created_at DESC);
CREATE UNIQUE INDEX idx_meeting_insight_dedupe
    ON meeting_insight_card(meeting_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL AND dedupe_key <> '';

CREATE TABLE meeting_summary (
    meeting_id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    summary_md TEXT NOT NULL DEFAULT '',
    decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    risks JSONB NOT NULL DEFAULT '[]'::jsonb,
    feedback JSONB NOT NULL DEFAULT '[]'::jsonb,
    tensions JSONB NOT NULL DEFAULT '[]'::jsonb,
    action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    memory_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_seq_start INT,
    source_seq_end INT,
    generated_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meeting_summary_session_fk
        FOREIGN KEY (meeting_id, workspace_id, project_id)
        REFERENCES meeting_session(id, workspace_id, project_id)
        ON DELETE CASCADE
);
