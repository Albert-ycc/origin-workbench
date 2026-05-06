"use client";

import type { DelegationTaskCard } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../../common/actor-avatar";
import { delegationStatusMeta } from "./delegation-status";

export function DelegationTaskRow({
  card,
  selected,
  onOpen,
}: {
  card: DelegationTaskCard;
  selected: boolean;
  onOpen: () => void;
}) {
  const meta = delegationStatusMeta[card.status];
  const Icon = meta.icon;
  const isRunning = card.status === "in_progress";
  const preview = card.latest_result_preview?.trim() || card.title;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${card.issue_key} ${card.title}`}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
        selected ? "bg-muted" : "hover:bg-muted/60",
      )}
    >
      {card.assignee_id ? (
        <ActorAvatar
          actorType="agent"
          actorId={card.assignee_id}
          size={22}
          className="shrink-0 rounded-full"
        />
      ) : (
        <div className="size-[22px] shrink-0 rounded-full bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12px] font-medium">
            {card.assignee_name ?? "未指派"}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {card.issue_key}
          </span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {preview}
        </div>
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
          meta.tone,
        )}
      >
        <Icon className={cn("size-3", isRunning && "animate-spin")} />
        {meta.label}
      </span>
    </button>
  );
}
