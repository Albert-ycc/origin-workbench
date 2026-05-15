DROP TABLE IF EXISTS meeting_summary;
DROP TABLE IF EXISTS meeting_insight_card;
DROP TABLE IF EXISTS meeting_transcript_segment;
DROP TABLE IF EXISTS meeting_session;

ALTER TABLE project DROP CONSTRAINT IF EXISTS project_id_workspace_unique;
