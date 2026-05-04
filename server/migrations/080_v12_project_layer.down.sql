-- Reverse 080_v12_project_layer

ALTER TABLE chat_session DROP COLUMN IF EXISTS compacted_into_session_id;
ALTER TABLE chat_session DROP COLUMN IF EXISTS last_compacted_at;

DROP INDEX IF EXISTS idx_council_session_project;
DROP INDEX IF EXISTS idx_chat_session_project;
DROP INDEX IF EXISTS idx_mailbox_item_project;
DROP INDEX IF EXISTS idx_tool_binding_project;
DROP INDEX IF EXISTS idx_exploration_project;
DROP INDEX IF EXISTS idx_idea_project;
DROP INDEX IF EXISTS idx_mission_project;

ALTER TABLE council_session DROP COLUMN IF EXISTS project_id;
ALTER TABLE chat_session DROP COLUMN IF EXISTS project_id;
ALTER TABLE mailbox_item DROP COLUMN IF EXISTS project_id;
ALTER TABLE tool_binding DROP COLUMN IF EXISTS project_id;
ALTER TABLE exploration DROP COLUMN IF EXISTS project_id;
ALTER TABLE idea DROP COLUMN IF EXISTS project_id;
ALTER TABLE mission DROP COLUMN IF EXISTS project_id;

DROP TABLE IF EXISTS agent_project_memory;

DROP INDEX IF EXISTS idx_project_workspace_status;
DROP INDEX IF EXISTS idx_project_team;

ALTER TABLE project DROP CONSTRAINT IF EXISTS project_status_check;
ALTER TABLE project ADD CONSTRAINT project_status_check
    CHECK (status IN ('planned', 'in_progress', 'paused', 'completed', 'cancelled'));

ALTER TABLE project DROP COLUMN IF EXISTS compaction_count;
ALTER TABLE project DROP COLUMN IF EXISTS memory_doc_updated_at;
ALTER TABLE project DROP COLUMN IF EXISTS memory_doc;
ALTER TABLE project DROP COLUMN IF EXISTS local_dir;
ALTER TABLE project DROP COLUMN IF EXISTS team_id;
