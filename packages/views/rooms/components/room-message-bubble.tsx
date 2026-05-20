"use client";

import { cn } from "@multica/ui/lib/utils";
import { Markdown } from "@multica/views/common/markdown";
import type { RoomMessage } from "@multica/core/types";
import { useRoomsStore } from "@multica/core/rooms";

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

  // agent / system bubble — brand-spec v2 styling within .living-room-scope
  return (
    <div className={cn("w-full", isMerged ? "mt-0.5" : "mt-3")}>
      {!isMerged && message.sender_name && (
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="text-[11.5px] font-medium"
            style={{ color: "var(--living-text-secondary, #86909C)" }}
          >
            {message.sender_name}
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
              · 自言自语
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
  );
}
