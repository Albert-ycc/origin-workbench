-- Origin AI Roundtable P0 — give council_session a structured strategy column.
--
-- Before this migration the WIP roundtable code stuffed framework /
-- expectedOutput / participant roles into the free-form `summary` TEXT
-- field with a `[AI_ROUNDTABLE_P0]` sentinel, then re-parsed it with
-- string matching. That makes role-perspective cards, disagreement
-- matrices, and 6-section conclusion templates impossible to persist
-- reliably.
--
-- strategy is the structured contract. Application-layer shape (the DB
-- only enforces "valid JSONB"):
--
-- {
--   "roundtable_type":  "brainstorm" | "review" | "decision" | null,
--   "framework_id":     string,        -- e.g. "double_diamond" / "six_hats" / custom
--   "framework_label":  string,        -- human label, allows custom frameworks
--   "expected_output":  string,
--   "participant_roles": [
--     { "agent_id": uuid, "role": string, "role_hint": string }
--   ],
--   "context_sources": [
--     { "type": "project"|"idea"|"mission"|"chat", "id": uuid, "label": string }
--   ],
--   "role_perspectives": [
--     {
--       "agent_id":     uuid,
--       "role":         string,
--       "position":     string,
--       "evidence":     string,
--       "self_rebuttal": string,
--       "risk_level":   "low" | "medium" | "high",
--       "suggestion":   string,
--       "updated_at":   ISO8601
--     }
--   ],
--   "disagreements": [
--     { "topic": string,
--       "stances": [{ "agent_id": uuid, "stance": string, "conditions": string }] }
--   ],
--   "conclusion_structured": {
--     "conclusion":         string,
--     "disagreements":      string,
--     "risks":              string,
--     "assumptions":        string,
--     "action_items":       string,
--     "memory_candidates":  string
--   }
-- }
--
-- All keys are optional; consumers must default-treat missing keys as
-- empty/absent. Existing rows get '{}' and behave exactly as today.

ALTER TABLE council_session
    ADD COLUMN strategy JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX idx_council_session_roundtable_type
    ON council_session((strategy->>'roundtable_type'))
    WHERE strategy ? 'roundtable_type';
