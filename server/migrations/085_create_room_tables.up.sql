-- 085_create_room_tables.up.sql
-- 客厅模块 v1.0.14：room 系列表 + chat_session 两列扩展

CREATE TABLE room (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    theme           TEXT NOT NULL DEFAULT 'default',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at     TIMESTAMPTZ,
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE room_member (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    member_type TEXT NOT NULL CHECK (member_type IN ('user', 'agent')),
    member_id   UUID NOT NULL,
    role        TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('owner', 'participant')),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at     TIMESTAMPTZ,
    UNIQUE (room_id, member_type, member_id)
);

CREATE TABLE room_message (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id             UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    sender_type         TEXT NOT NULL CHECK (sender_type IN ('user', 'agent', 'system')),
    sender_id           UUID NOT NULL,
    content             TEXT NOT NULL DEFAULT '',
    reply_to_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    mentions            TEXT[] NOT NULL DEFAULT '{}',
    is_autonomous       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE room_agent_persona (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id          UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    agent_id         UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    persona_override JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (room_id, agent_id)
);

-- 预留空表，v1.0.15+ 业务逻辑再写
CREATE TABLE room_autonomous_event (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id    UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    agent_id   UUID NOT NULL,
    event_type TEXT NOT NULL,
    payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE room_relationship (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id          UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    from_member_type TEXT NOT NULL,
    from_member_id   UUID NOT NULL,
    to_member_type   TEXT NOT NULL,
    to_member_id     UUID NOT NULL,
    relation_type    TEXT NOT NULL DEFAULT 'acquaintance',
    strength         SMALLINT NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (room_id, from_member_type, from_member_id, to_member_type, to_member_id)
);

-- chat_session 加两列：room_id 关联客厅 + is_room_internal 标记客厅内部虚拟 session
ALTER TABLE chat_session ADD COLUMN room_id UUID REFERENCES room(id) ON DELETE SET NULL;
ALTER TABLE chat_session ADD COLUMN is_room_internal BOOLEAN NOT NULL DEFAULT FALSE;

-- 索引
CREATE INDEX idx_room_workspace_active   ON room (workspace_id, archived_at, last_active_at DESC);
CREATE INDEX idx_room_member_room        ON room_member (room_id, member_type);
CREATE INDEX idx_room_member_member      ON room_member (member_type, member_id);
CREATE INDEX idx_room_message_room_time  ON room_message (room_id, created_at DESC);
CREATE INDEX idx_room_message_sender     ON room_message (sender_type, sender_id, created_at DESC);
CREATE INDEX idx_room_auto_event_room    ON room_autonomous_event (room_id, created_at DESC);
CREATE INDEX idx_room_relationship_from  ON room_relationship (room_id, from_member_type, from_member_id);
CREATE INDEX idx_chat_session_room       ON chat_session (room_id) WHERE room_id IS NOT NULL;
