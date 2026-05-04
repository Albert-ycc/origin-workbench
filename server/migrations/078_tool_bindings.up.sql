-- Origin §14.9 — ToolBinding: attach real-world working surfaces (Lark
-- docs, FigJam boards, Figma files, Obsidian notes, local repos) to
-- Missions / Agents / Ideas / Councils so an agent can read or — once the
-- user explicitly enables write — also push results back into the user's
-- existing tools instead of staying inside the chat.
--
-- Phase 4 first cut: data backbone + UI on Mission detail page. Daemon-side
-- propagation (so the agent CLI auto-receives the binding info) ships in a
-- later cut. Until then, the user references binding labels in chat
-- manually.

CREATE TABLE tool_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

    tool_type TEXT NOT NULL CHECK (tool_type IN (
        'lark_doc', 'lark_whiteboard', 'figma_file', 'obsidian_note', 'local_repo'
    )),
    -- resource_ref carries the tool-specific identifier(s) — URL, file token,
    -- vault + path, etc. Stored as JSONB so each tool can extend its shape
    -- without a migration.
    resource_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    label TEXT NOT NULL DEFAULT '',
    -- Default read-only. The user must explicitly toggle write_enabled before
    -- the agent is allowed to push changes back. PRD §14.9.3 risk control.
    write_enabled BOOLEAN NOT NULL DEFAULT false,

    -- A binding lives under exactly one of: mission / agent / idea / council.
    -- Multiple subjects per binding would make ownership ambiguous (which
    -- object's archive should cascade?), so we constrain to one and let the
    -- user create separate bindings if they want the same resource on two
    -- subjects.
    mission_id UUID REFERENCES mission(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agent(id) ON DELETE CASCADE,
    idea_id UUID REFERENCES idea(id) ON DELETE CASCADE,
    council_session_id UUID REFERENCES council_session(id) ON DELETE CASCADE,

    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (
        (mission_id IS NOT NULL)::int +
        (agent_id IS NOT NULL)::int +
        (idea_id IS NOT NULL)::int +
        (council_session_id IS NOT NULL)::int = 1
    )
);

CREATE INDEX idx_tool_binding_workspace
    ON tool_binding(workspace_id, updated_at DESC);
CREATE INDEX idx_tool_binding_mission ON tool_binding(mission_id)
    WHERE mission_id IS NOT NULL;
CREATE INDEX idx_tool_binding_agent ON tool_binding(agent_id)
    WHERE agent_id IS NOT NULL;
CREATE INDEX idx_tool_binding_idea ON tool_binding(idea_id)
    WHERE idea_id IS NOT NULL;
CREATE INDEX idx_tool_binding_council ON tool_binding(council_session_id)
    WHERE council_session_id IS NOT NULL;
