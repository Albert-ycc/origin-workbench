-- Origin UserProfile (PRD §14.10): user-written preferences and identity
-- card that get injected as the closest layer of the three-layer system
-- prompt (UserProfile.style_notes → Agent.long_context → Mission.bound_contexts).
-- Single instance per (workspace, user). Currently Origin runs single-user
-- single-workspace, so in practice there is exactly one row.

CREATE TABLE user_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role_card TEXT NOT NULL DEFAULT '',
    communication_style TEXT NOT NULL DEFAULT '',
    presence TEXT NOT NULL DEFAULT 'online'
        CHECK (presence IN ('online', 'offline', 'dnd')),
    preferences_source_path TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX idx_user_profile_workspace ON user_profile(workspace_id);
