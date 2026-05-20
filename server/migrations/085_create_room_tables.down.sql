-- 085_create_room_tables.down.sql
-- 回滚：先删依赖 room 的索引和外键列，再删表

DROP INDEX IF EXISTS idx_chat_session_room;
ALTER TABLE chat_session DROP COLUMN IF EXISTS is_room_internal;
ALTER TABLE chat_session DROP COLUMN IF EXISTS room_id;

DROP TABLE IF EXISTS room_relationship;
DROP TABLE IF EXISTS room_autonomous_event;
DROP TABLE IF EXISTS room_agent_persona;
DROP TABLE IF EXISTS room_message;
DROP TABLE IF EXISTS room_member;
DROP TABLE IF EXISTS room;
