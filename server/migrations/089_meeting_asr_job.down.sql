DROP TABLE IF EXISTS meeting_asr_job;

ALTER TABLE meeting_audio_asset
    DROP CONSTRAINT IF EXISTS meeting_audio_asset_scope_unique;
