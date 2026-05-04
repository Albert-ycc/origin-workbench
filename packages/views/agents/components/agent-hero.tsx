"use client";

import { useMemo, useState } from "react";
import { Inbox, MessageSquare, Pencil } from "lucide-react";
import type {
  Agent,
  AgentNotifyPolicy,
  AgentRuntime,
  AgentWorkMode,
  MemberWithUser,
} from "@multica/core/types";
import type { AgentPresenceDetail } from "@multica/core/agents";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../../common/actor-avatar";
import { availabilityConfig } from "../presence";
import { EditAgentDialog } from "./edit-agent-dialog";

interface AgentHeroProps {
  agent: Agent;
  runtime: AgentRuntime | null;
  owner: MemberWithUser | null;
  presence: AgentPresenceDetail | null | undefined;
  runtimes: AgentRuntime[];
  members: MemberWithUser[];
  currentUserId: string | null;
  canEdit: boolean;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
}

/**
 * Agent home hero block — modeled on the QoderWake reference design:
 *
 *   [avatar]  Name
 *             ● 在线  入职日期：YYYY-MM-DD
 *             一句话职责描述
 *             ✏️ 编辑
 *             ID: xxxxxxxx
 *
 * No runtime/model attribute pills here — those belong in the edit dialog
 * (or, in the long term, on a settings tab). Keeping the hero text-first
 * makes the page read like an agent profile, not a config form.
 */
export function AgentHero({
  agent,
  runtime,
  owner,
  presence,
  runtimes,
  members,
  currentUserId,
  canEdit,
  onUpdate,
}: AgentHeroProps) {
  const [editing, setEditing] = useState(false);
  const availability = presence
    ? availabilityConfig[presence.availability]
    : null;
  const tenureIso = useMemo(() => {
    const d = new Date(agent.created_at);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }, [agent.created_at]);

  return (
    <>
      <div className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-6xl gap-6 px-6 py-6">
          <ActorAvatar
            actorType="agent"
            actorId={agent.id}
            size={104}
            className="shrink-0 rounded-2xl ring-2 ring-border"
          />

          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {agent.name}
            </h1>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {availability ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      availability.dotClass,
                    )}
                  />
                  {availability.label}
                </span>
              ) : (
                <span>状态同步中</span>
              )}
              {tenureIso && (
                <span>入职日期：{tenureIso}</span>
              )}
              {agent.archived_at && (
                <span className="rounded-full border px-2 py-0.5 text-[10px]">
                  已归档
                </span>
              )}
            </div>

            <p
              className={cn(
                "max-w-3xl text-sm leading-relaxed",
                agent.description
                  ? "text-foreground/80"
                  : "italic text-muted-foreground/55",
              )}
            >
              {agent.description || "还没有填写职责描述"}
            </p>

            <div className="flex items-center gap-3 pt-1">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3" />
                  编辑
                </button>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                ID
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {agent.id.slice(0, 8)}
                </code>
              </span>
              {runtime && (
                <span className="text-[11px] text-muted-foreground">
                  · 运行环境 {runtime.name}
                </span>
              )}
              {owner && (
                <span className="text-[11px] text-muted-foreground">
                  · 所有者 {owner.name}
                </span>
              )}
            </div>

            {canEdit && (
              <WorkModeStrip agent={agent} onUpdate={onUpdate} />
            )}
          </div>
        </div>
      </div>

      {/* WorkModeStrip is defined below — kept colocated because it's only
          ever used by the hero. */}

      {editing && (
        <EditAgentDialog
          agent={agent}
          runtime={runtime}
          owner={owner}
          presence={presence}
          runtimes={runtimes}
          members={members}
          currentUserId={currentUserId}
          canEdit={canEdit}
          onUpdate={onUpdate}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

// PRD §14.8 — Agent work-mode toggle. Lives on the hero so flipping between
// "wait for me inline" (live) and "queue it, ping me later" (mailbox) is one
// click without going into the edit dialog. When mailbox is active we also
// surface the processing budget and the notify policy as inline pickers,
// because both directly affect what the user can expect from block 6.
function WorkModeStrip({
  agent,
  onUpdate,
}: {
  agent: Agent;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const setMode = async (mode: AgentWorkMode) => {
    if (busy || mode === agent.work_mode) return;
    setBusy(true);
    try {
      await onUpdate(agent.id, { work_mode: mode });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <span className="text-[11px] font-medium text-muted-foreground">
        工作模式
      </span>
      <div className="inline-flex overflow-hidden rounded-md border bg-background text-xs">
        <button
          type="button"
          onClick={() => setMode("live")}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 transition-colors",
            agent.work_mode === "live"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <MessageSquare className="size-3" />
          实时对话
        </button>
        <button
          type="button"
          onClick={() => setMode("mailbox")}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1.5 border-l px-3 py-1 transition-colors",
            agent.work_mode === "mailbox"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Inbox className="size-3" />
          信箱
        </button>
      </div>

      {agent.work_mode === "mailbox" ? (
        <>
          <BudgetPicker
            agent={agent}
            disabled={busy}
            onChange={(seconds) => onUpdate(agent.id, { mailbox_budget_seconds: seconds })}
          />
          <NotifyPolicyPicker
            agent={agent}
            disabled={busy}
            onChange={(policy) => onUpdate(agent.id, { notify_policy: policy })}
          />
        </>
      ) : (
        <span className="text-[11px] text-muted-foreground">
          实时模式：派给它的对话会在窗口里等回复。
        </span>
      )}
    </div>
  );
}

const BUDGET_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 900, label: "15 分钟" },
  { value: 1800, label: "30 分钟" },
  { value: 3600, label: "1 小时" },
  { value: 7200, label: "2 小时" },
  { value: 14400, label: "4 小时" },
];

function BudgetPicker({
  agent,
  disabled,
  onChange,
}: {
  agent: Agent;
  disabled: boolean;
  onChange: (seconds: number) => Promise<void>;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      处理预算
      <select
        disabled={disabled}
        value={agent.mailbox_budget_seconds}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
      >
        {BUDGET_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        {/* Render the current value even if it doesn't match a preset so a
            custom budget set elsewhere doesn't look broken in the dropdown. */}
        {!BUDGET_OPTIONS.some((o) => o.value === agent.mailbox_budget_seconds) && (
          <option value={agent.mailbox_budget_seconds}>
            {agent.mailbox_budget_seconds} 秒
          </option>
        )}
      </select>
    </label>
  );
}

const NOTIFY_OPTIONS: Array<{ value: AgentNotifyPolicy; label: string }> = [
  { value: "both", label: "完成 + 卡点都通知" },
  { value: "on_complete", label: "仅完成时通知" },
  { value: "on_block", label: "仅卡点时通知" },
];

function NotifyPolicyPicker({
  agent,
  disabled,
  onChange,
}: {
  agent: Agent;
  disabled: boolean;
  onChange: (policy: AgentNotifyPolicy) => Promise<void>;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      通知策略
      <select
        disabled={disabled}
        value={agent.notify_policy}
        onChange={(e) => onChange(e.target.value as AgentNotifyPolicy)}
        className="rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
      >
        {NOTIFY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
