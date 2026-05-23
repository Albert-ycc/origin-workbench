-- 087_drop_mailbox: remove the deprecated mailbox mode and report table.

DROP TABLE IF EXISTS mailbox_item;

ALTER TABLE agent
    DROP COLUMN IF EXISTS notify_policy,
    DROP COLUMN IF EXISTS mailbox_budget_seconds,
    DROP COLUMN IF EXISTS work_mode;
