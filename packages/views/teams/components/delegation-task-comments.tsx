"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { useIssueTimeline } from "../../issues/hooks";
import { Markdown } from "../../common/markdown";

export function DelegationTaskComments({
  issueId,
  userId,
}: {
  issueId: string;
  userId?: string | null;
}) {
  const { timeline, loading, submitting, submitComment } = useIssueTimeline(
    issueId,
    userId ?? undefined,
  );
  const [draft, setDraft] = useState("");

  const onSubmit = async () => {
    const content = draft.trim();
    if (!content) return;
    await submitComment(content);
    setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background/60 p-3">
        {loading ? (
          <div className="text-sm text-muted-foreground">加载评论中…</div>
        ) : timeline.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无评论。</div>
        ) : (
          <div className="flex flex-col gap-3">
            {timeline.map((entry) => {
              const isAgent = entry.actor_type === "agent";
              const content = entry.content ?? "";
              return (
                <div key={entry.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span
                      className={cn("font-medium", isAgent && "text-primary")}
                    >
                      {isAgent ? "Agent" : "成员"}
                    </span>
                    <span>{entry.actor_id}</span>
                  </div>
                  {entry.type === "comment" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                      <Markdown>{content}</Markdown>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {entry.action ?? content}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={userId ? "补充评论…" : "登录后可评论"}
          rows={2}
          disabled={!userId || submitting}
          className="resize-none"
        />
        <Button
          type="button"
          size="icon"
          disabled={!draft.trim() || !userId || submitting}
          onClick={onSubmit}
          aria-label="发送评论"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
