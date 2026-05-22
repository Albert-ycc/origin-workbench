-- Origin Salon Mode（圆桌客厅）— 给 council_session 增加 salon 模式。
--
-- 现状（v1.0.13）：council fan-out 是 lead → follower 两段串行 relay，
-- 结束在 follower 发完话就停，定位是「跨角色决议室」。
--
-- v1.0.14 新增「沙龙」模式：多个 agent 轮流发言陪伴用户，按 max_turns
-- 数量自动循环，没有 conclusion 压力，定位是「群体陪伴客厅」。
--
-- 设计取舍：
-- - 不引入新表，复用 council_session + council_session_participant。
-- - 不引入 persona 表，salon prompt 直接在 daemon 里通过 prompt 注入
--   「松弛陪伴」persona override，保持现有 agent 体系不变。
-- - current_turn 是运行态，不存表；改在 CouncilBroadcastContext.TurnIndex
--   随任务 payload 流转，调度器无状态。

ALTER TABLE council_session
    ADD COLUMN mode TEXT NOT NULL DEFAULT 'relay'
        CHECK (mode IN ('relay', 'salon')),
    ADD COLUMN max_turns INT NOT NULL DEFAULT 8
        CHECK (max_turns >= 2 AND max_turns <= 24);

-- 已有 council 全部是 relay 模式，default 已覆盖；这里仅作显式声明。
UPDATE council_session SET mode = 'relay' WHERE mode IS NULL;
