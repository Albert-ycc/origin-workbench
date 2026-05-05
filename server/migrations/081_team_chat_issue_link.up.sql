-- 081_team_chat_issue_link: 让 issue 知道自己来自哪条群聊消息
--
-- D 方案：把 captain 在团队群聊里的 @ 派活落到 issue 表上（不再起独立
-- chat task）。这两列是"派活卡片回流"的桥梁——issue 完成时通过这两列把
-- 完成事件 mirror 回 source_team_session，让群聊的派活闭环可见。
--
-- 都是 nullable：v1.0 issue 主路径（手工创建/quick-create/comment-triggered）
-- 不动，只有团队 captain 派的 issue 才会填这两列。

ALTER TABLE issue
    ADD COLUMN source_team_message_id UUID REFERENCES chat_message(id) ON DELETE SET NULL,
    ADD COLUMN source_team_session_id UUID REFERENCES chat_session(id) ON DELETE SET NULL;

-- 反查 captain 的某条 message 派出了哪些 issue（前端 TaskCardList 用）
CREATE INDEX idx_issue_source_team_message
    ON issue(source_team_message_id)
    WHERE source_team_message_id IS NOT NULL;

-- 反查某个团队 chat session 的所有派出 issue（团队详情页用）
CREATE INDEX idx_issue_source_team_session
    ON issue(source_team_session_id)
    WHERE source_team_session_id IS NOT NULL;
