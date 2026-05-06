"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { issueDetailOptions } from "@multica/core/issues/queries";
import type { DelegationTaskCard } from "@multica/core/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@multica/ui/components/ui/sheet";
import { cn } from "@multica/ui/lib/utils";
import { Markdown } from "../../common/markdown";
import { delegationStatusMeta } from "./delegation-status";
import { DelegationTaskComments } from "./delegation-task-comments";

export function DelegationTaskDetailDrawer({
  card,
  open,
  onOpenChange,
  userId,
  onCommentSubmitted,
}: {
  card: DelegationTaskCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string | null;
  onCommentSubmitted?: () => void;
}) {
  const wsId = useWorkspaceId();
  const issueId = card?.issue_id ?? "";
  const issueQuery = useQuery({
    ...issueDetailOptions(wsId, issueId),
    enabled: open && !!card,
  });
  const issue = issueQuery.data;
  const title = issue?.title ?? card?.title ?? "";
  const instruction = issue?.description || card?.title || "";
  const meta = card ? delegationStatusMeta[card.status] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:!max-w-[560px]">
        {card && meta && (
          <div className="flex min-h-0 flex-1 flex-col">
            <SheetHeader className="border-b">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {card.issue_key}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                    meta.tone,
                  )}
                >
                  {meta.label}
                </span>
              </div>
              <SheetTitle className="pr-8">{title}</SheetTitle>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
              <section className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  任务说明
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border bg-background/60 p-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  {issueQuery.isLoading ? (
                    <div className="text-sm text-muted-foreground">加载中…</div>
                  ) : (
                    <Markdown>{instruction}</Markdown>
                  )}
                </div>
              </section>

              <section className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  过程与回报
                </div>
                <DelegationTaskComments
                  issueId={card.issue_id}
                  userId={userId}
                  onCommentSubmitted={onCommentSubmitted}
                />
              </section>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
