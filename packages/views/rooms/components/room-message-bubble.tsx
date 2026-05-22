"use client";

import { cn } from "@multica/ui/lib/utils";
import { Markdown } from "@multica/views/common/markdown";
import type { RoomMessage } from "@multica/core/types";
import { useRoomsStore } from "@multica/core/rooms";
import { ActorAvatar } from "@multica/views/common/actor-avatar";

interface RoomMessageBubbleProps {
  message: RoomMessage;
  /** Merged with previous message from same sender — suppresses name row */
  isMerged?: boolean;
}

export function RoomMessageBubble({ message, isMerged = false }: RoomMessageBubbleProps) {
  // Check if there's a live streaming chunk for this message
  const streamingChunk = useRoomsStore((s) => s.chunkBuffer.get(message.id));
  const displayContent = streamingChunk !== undefined ? streamingChunk : message.content;

  if (message.sender_type === "user") {
    return (
      <div className={cn("flex justify-end", isMerged ? "mt-0.5" : "mt-3")}>
        <div
          className="rounded-lg px-3.5 py-2 text-sm max-w-[80%] break-words"
          style={{
            background: "#F0F5FF",
            border: "1px solid rgba(22,119,255,0.15)",
            color: "var(--living-text-primary, #1F2329)",
          }}
        >
          <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <Markdown>{displayContent}</Markdown>
          </div>
        </div>
      </div>
    );
  }

  if (message.sender_type === "system") {
    return (
      <div className={cn("flex justify-center", isMerged ? "mt-0.5" : "mt-3")}>
        <span className="max-w-[80%] rounded-full border bg-muted/60 px-3 py-1 text-center text-xs text-muted-foreground">
          {displayContent}
        </span>
      </div>
    );
  }

  // agent bubble — mirrors the workspace team chat rhythm with avatar + metadata.
  return (
    <div className={cn("flex gap-2", isMerged ? "mt-0.5" : "mt-3")}>
      {!isMerged ? (
        <ActorAvatar
          actorType="agent"
          actorId={message.sender_id}
          size={32}
          className="mt-0.5 rounded-full"
          showStatusDot
        />
      ) : (
        <div className="mt-0.5 size-8 shrink-0" />
      )}
      <div className="group flex max-w-[80%] flex-col gap-1">
        {!isMerged && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>
              {message.sender_name ?? "未知智能体"}
            </span>
            {message.is_autonomous && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  color: "var(--living-accent-orange, #F59E0B)",
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.2)",
                }}
              >
                自言自语
              </span>
            )}
          </div>
        )}
        <div
          className={cn(
            "room-message-bubble relative px-3.5 py-2 text-sm",
            message.is_autonomous && "autonomous-bubble",
          )}
          style={message.is_autonomous ? { borderLeft: "4px solid #F59E0B" } : undefined}
        >
          <div className="text-sm leading-relaxed prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <Markdown>{displayContent || "​"}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}
