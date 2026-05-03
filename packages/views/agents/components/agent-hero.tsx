"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import type {
  Agent,
  AgentRuntime,
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
          </div>
        </div>
      </div>

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
