"use client";

import { Badge } from "@multica/ui/components/ui/badge";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../../common/actor-avatar";
import type { AgentRow } from "./agent-columns";
import { AgentRowActions } from "./agent-row-actions";

export const agentBadgeMetaLabels = [
  "入职时间",
  "当前模型",
  "运行次数",
] as const;

export const agentBadgeCardClassName =
  "group relative flex min-h-[18rem] w-[220px] overflow-hidden rounded-lg border border-border/80 bg-card text-card-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.14)] transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_26px_rgba(0,0,0,0.2)]" as const;

export function formatAgentStartDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
}

export function getAgentModelLabel(model: string) {
  return model.trim() || "继承默认";
}

export function AgentCard({
  row,
  onOpen,
  onDuplicate,
}: {
  row: AgentRow;
  onOpen: () => void;
  onDuplicate: () => void;
}) {
  const { agent, presence, canManage } = row;
  const archived = !!agent.archived_at;
  const meta = [
    [agentBadgeMetaLabels[0], formatAgentStartDate(agent.created_at)],
    [agentBadgeMetaLabels[1], getAgentModelLabel(agent.model)],
    [agentBadgeMetaLabels[2], row.runCount.toLocaleString()],
  ] as const;

  return (
    <article
      className={cn(agentBadgeCardClassName, archived && "opacity-70 grayscale")}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-muted/40 to-transparent" />
      <div
        className="absolute right-2 top-2 z-20"
        onClick={(e) => e.stopPropagation()}
      >
        <AgentRowActions
          agent={agent}
          presence={presence}
          canManage={canManage}
          onDuplicate={onDuplicate}
        />
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="relative flex min-h-0 w-full flex-1 flex-col items-center px-3 pb-3 pt-2.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="h-1 w-12 rounded-full bg-muted-foreground/18 shadow-inner" />

        <div className="relative mt-3">
          <span className="absolute inset-0 rounded-full bg-primary/10 blur-lg transition-opacity group-hover:opacity-90" />
          <ActorAvatar
            actorType="agent"
            actorId={agent.id}
            size={78}
            className="relative rounded-full ring-[3px] ring-background shadow-md"
            enableHoverCard
            showStatusDot={!archived}
          />
        </div>

        <div className="mt-2.5 flex max-w-full items-center justify-center gap-1.5">
          <h2
            className={cn(
              "min-w-0 truncate text-sm font-semibold tracking-normal",
              archived && "text-muted-foreground",
            )}
          >
            {agent.name}
          </h2>
          {archived && (
            <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
              已归档
            </Badge>
          )}
        </div>

        <p
          className={cn(
            "mt-1 line-clamp-2 min-h-8 w-full text-[11px] leading-relaxed",
            agent.description
              ? "text-muted-foreground"
              : "italic text-muted-foreground/55",
          )}
        >
          {agent.description || "还没有填写职责描述"}
        </p>

        <div className="mt-auto w-full border-t pt-2.5">
          <dl className="space-y-1.5 text-[11px]">
            {meta.map(([label, value]) => (
              <div
                key={label}
                className="flex min-w-0 items-center justify-between gap-3"
              >
                <dt className="shrink-0 whitespace-nowrap text-muted-foreground">
                  {label}
                </dt>
                <dd className="min-w-0 truncate font-mono tabular-nums text-foreground/85">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {presence && !archived && (
            <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  presence.availability === "online"
                    ? "bg-emerald-500"
                    : presence.availability === "unstable"
                      ? "bg-amber-500"
                      : "bg-muted-foreground/50",
                )}
              />
              <span>
                {presence.availability === "online"
                  ? "在线"
                  : presence.availability === "unstable"
                    ? "不稳定"
                    : "离线"}
              </span>
            </div>
          )}
        </div>
      </button>
    </article>
  );
}
