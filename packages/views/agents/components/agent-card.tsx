"use client";

import { MessageSquare, Sparkles } from "lucide-react";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../../common/actor-avatar";
import { availabilityConfig, workloadConfig } from "../presence";
import type { AgentRow } from "./agent-columns";
import { AgentRowActions } from "./agent-row-actions";

export function AgentCard({
  row,
  onOpen,
  onChat,
  onDuplicate,
}: {
  row: AgentRow;
  onOpen: () => void;
  onChat: () => void;
  onDuplicate: () => void;
}) {
  const { agent, presence, runtime, canManage } = row;
  const archived = !!agent.archived_at;
  const availability = presence ? availabilityConfig[presence.availability] : null;
  const workload = presence ? workloadConfig[presence.workload] : null;

  return (
    <article
      className={cn(
        "group relative flex flex-col rounded-2xl border bg-background p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        archived && "opacity-70 grayscale",
      )}
    >
      <div className="absolute right-2 top-2 z-10" onClick={(e) => e.stopPropagation()}>
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
        className="flex flex-1 flex-col items-center text-center focus-visible:outline-none"
      >
        <ActorAvatar
          actorType="agent"
          actorId={agent.id}
          size={56}
          className="rounded-full ring-2 ring-muted/60"
          enableHoverCard
          showStatusDot
        />
        <div className="mt-3 flex max-w-full items-center gap-2">
          <h2 className="truncate text-base font-semibold tracking-normal">
            {agent.name}
          </h2>
          {archived && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              已归档
            </Badge>
          )}
        </div>
        <p
          className={cn(
            "mt-2 line-clamp-2 min-h-9 max-w-full text-xs leading-relaxed",
            agent.description
              ? "text-muted-foreground"
              : "italic text-muted-foreground/55",
          )}
        >
          {agent.description || "还没有填写职责描述"}
        </p>

        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {availability ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", availability.dotClass)} />
              {availability.label}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              状态同步中
            </span>
          )}
          {workload && (
            <span className={cn("inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px]", workload.textClass)}>
              {workload.label}
            </span>
          )}
        </div>
      </button>

      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <Button
          type="button"
          size="sm"
          className="h-8 w-full rounded-full bg-emerald-500 text-white hover:bg-emerald-600"
          disabled={archived}
          onClick={onChat}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          对话
        </Button>
      </div>

      <div className="mt-3 flex min-w-0 items-center justify-center gap-1.5 border-t pt-2 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {runtime?.name ?? "未绑定运行环境"}
          {agent.model ? ` · ${agent.model}` : ""}
        </span>
      </div>
    </article>
  );
}
