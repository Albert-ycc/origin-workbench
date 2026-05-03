-- Phase 2: Teams of agents.
-- A team has one captain agent and zero+ member agents, plus a shared
-- group-chat session that reuses chat_session / chat_message — chat_session
-- gains a nullable team_id and the existing agent_id becomes nullable, with
-- a CHECK guaranteeing exactly one of (agent_id, team_id) is set.

CREATE TABLE team (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- Captain is the single agent responsible for triaging group-chat
    -- messages. ON DELETE RESTRICT prevents silent loss: deleting a captain
    -- agent forces the user to pick a new one or disband the team first.
    captain_agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE RESTRICT,
    created_by_user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_workspace ON team(workspace_id) WHERE archived_at IS NULL;
CREATE INDEX idx_team_captain ON team(captain_agent_id);

-- team_member: includes the captain (role='captain') so a single query
-- returns the full roster. Composite PK enforces "an agent appears in a
-- team at most once".
CREATE TABLE team_member (
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('captain', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, agent_id)
);

CREATE INDEX idx_team_member_agent ON team_member(agent_id);

-- chat_session: extend with team_id, relax agent_id to nullable, and add a
-- CHECK so a session is exactly one of (1:1-agent, team-group). All
-- existing rows have agent_id NOT NULL and team_id IS NULL → CHECK passes.
ALTER TABLE chat_session
    ALTER COLUMN agent_id DROP NOT NULL,
    ADD COLUMN team_id UUID REFERENCES team(id) ON DELETE CASCADE,
    ADD CONSTRAINT chat_session_agent_xor_team
        CHECK ((agent_id IS NULL) <> (team_id IS NULL));

CREATE INDEX idx_chat_session_team ON chat_session(team_id) WHERE team_id IS NOT NULL;

-- chat_message: add sender_agent_id so team-session assistant messages can
-- attribute which agent produced the reply. For 1:1 chat sessions this
-- column stays NULL (the session.agent_id is already authoritative).
ALTER TABLE chat_message
    ADD COLUMN sender_agent_id UUID REFERENCES agent(id) ON DELETE SET NULL;

CREATE INDEX idx_chat_message_sender_agent ON chat_message(sender_agent_id) WHERE sender_agent_id IS NOT NULL;
