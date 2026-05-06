"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { delegationTaskCardsOptions } from "@multica/core/teams";
import { useWorkspaceId } from "@multica/core/hooks";
import type { DelegationTaskCard } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import {
  type DelegationFilter,
  filterDelegationStatus,
} from "./delegation-status";
import { DelegationTaskDetailDrawer } from "./delegation-task-detail-drawer";
import { DelegationTaskRow } from "./delegation-task-row";

const FILTERS: { value: DelegationFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "reported", label: "已回报" },
  { value: "blocked", label: "卡点" },
];

export function DelegationBoard({
  messageId,
  userId,
}: {
  messageId: string;
  userId?: string | null;
}) {
  const wsId = useWorkspaceId();
  const { data: cards = [], isLoading } = useQuery(
    delegationTaskCardsOptions(wsId, messageId),
  );
  const [filter, setFilter] = useState<DelegationFilter>("all");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const counts = useMemo(
    () => ({
      active: cards.filter((card) =>
        filterDelegationStatus(card.status, "active"),
      ).length,
      reported: cards.filter((card) =>
        filterDelegationStatus(card.status, "reported"),
      ).length,
      blocked: cards.filter((card) =>
        filterDelegationStatus(card.status, "blocked"),
      ).length,
    }),
    [cards],
  );
  const visibleCards = useMemo(
    () => cards.filter((card) => filterDelegationStatus(card.status, filter)),
    [cards, filter],
  );
  const selectedCard =
    cards.find((card) => card.issue_id === selectedIssueId) ?? null;

  if (isLoading || cards.length === 0) {
    return null;
  }

  const openCard = (card: DelegationTaskCard) => {
    setSelectedIssueId(card.issue_id);
    setDrawerOpen(true);
  };

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
      <div className="flex items-center gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            派出的任务 · {cards.length} 张
          </div>
          <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span>已回报 {counts.reported}</span>
            <span>进行中 {counts.active}</span>
            <span>卡点 {counts.blocked}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((item) => (
          <Button
            key={item.value}
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              "h-6 rounded-md px-2 text-[11px]",
              filter === item.value && "bg-muted text-foreground",
            )}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {visibleCards.length === 0 ? (
        <div className="px-2.5 py-2 text-[12px] text-muted-foreground">
          当前筛选下没有任务。
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {visibleCards.map((card) => (
            <DelegationTaskRow
              key={card.issue_id}
              card={card}
              selected={card.issue_id === selectedIssueId && drawerOpen}
              onOpen={() => openCard(card)}
            />
          ))}
        </div>
      )}

      <DelegationTaskDetailDrawer
        card={selectedCard}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        userId={userId}
      />
    </div>
  );
}
