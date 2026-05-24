"use client";

import { cn } from "@multica/ui/lib/utils";
import { Markdown } from "@multica/views/common/markdown";
import type { RoomMessage } from "@multica/core/types";
import { useRoomsStore } from "@multica/core/rooms";
import { ActorAvatar } from "@multica/views/common/actor-avatar";
import { Reply } from "lucide-react";

interface RoomMessageBubbleProps {
  message: RoomMessage;
  /** Merged with previous message from same sender — suppresses name row */
  isMerged?: boolean;
  replyToMessage?: RoomMessage;
  onReply?: (message: RoomMessage) => void;
}

export function RoomMessageBubble({
  message,
  isMerged = false,
  replyToMessage,
  onReply,
}: RoomMessageBubbleProps) {
  // Check if there's a live streaming chunk for this message
  const streamingChunk = useRoomsStore((s) => s.chunkBuffer.get(message.id));
  const displayContent = streamingChunk !== undefined ? streamingChunk : message.content;
  const senderName =
    message.sender_type === "user" ? "你" : message.sender_name ?? "未知智能体";

  if (message.sender_type === "user") {
    return (
      <div className={cn("group flex flex-row-reverse gap-2", isMerged ? "mt-0.5" : "mt-3")}>
        {!isMerged ? (
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
            我
          </div>
        ) : (
          <div className="mt-0.5 size-8 shrink-0" />
        )}
        <div className="flex max-w-[75%] flex-col items-end gap-1">
          {!isMerged && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>你</span>
              <span>{formatTime(message.created_at)}</span>
            </div>
          )}
          <div
            className="rounded-2xl bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground"
          >
            <QuotedMessagePreview message={replyToMessage} isMe />
            <div className="whitespace-pre-wrap break-words">{displayContent}</div>
          </div>
          <MessageActions message={message} senderName={senderName} onReply={onReply} align="right" />
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
    <div className={cn("group flex gap-2", isMerged ? "mt-0.5" : "mt-3")}>
      {!isMerged ? (
        <div className="mt-0.5 shrink-0">
          <ActorAvatar
            actorType="agent"
            actorId={message.sender_id}
            size={32}
            className="rounded-full"
            showStatusDot
          />
        </div>
      ) : (
        <div className="mt-0.5 size-8 shrink-0" />
      )}
      <div className="group flex max-w-[80%] flex-col gap-1">
        {!isMerged && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>
              {senderName}
            </span>
            <span>{formatTime(message.created_at)}</span>
            {message.is_autonomous && (
              <span className="room-autonomous-badge rounded px-1.5 py-0.5 text-[10px]">
                自言自语
              </span>
            )}
          </div>
        )}
        <div
          className={cn(
            "room-message-bubble relative rounded-2xl px-3.5 py-2 text-sm",
            message.is_autonomous && "autonomous-bubble",
          )}
          style={message.is_autonomous ? { borderLeftWidth: 4 } : undefined}
        >
          <QuotedMessagePreview message={replyToMessage} />
          <div className="text-sm leading-relaxed prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <Markdown>{displayContent || "​"}</Markdown>
          </div>
        </div>
        <MessageActions message={message} senderName={senderName} onReply={onReply} />
      </div>
    </div>
  );
}

function MessageActions({
  message,
  senderName,
  onReply,
  align = "left",
}: {
  message: RoomMessage;
  senderName: string;
  onReply?: (message: RoomMessage) => void;
  align?: "left" | "right";
}) {
  if (!onReply || message.sender_type === "system") return null;

  return (
    <div
      className={cn(
        "flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        align === "right" && "justify-end",
      )}
    >
      <button
        type="button"
        aria-label={`引用${senderName}的消息`}
        onClick={() => onReply(message)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Reply className="size-3" />
        引用
      </button>
    </div>
  );
}

function QuotedMessagePreview({
  message,
  isMe = false,
}: {
  message?: RoomMessage;
  isMe?: boolean;
}) {
  if (!message) return null;

  return (
    <div
      className={cn(
        "mb-2 rounded-md border-l-2 px-2 py-1 text-xs",
        isMe
          ? "border-primary-foreground/50 bg-primary-foreground/10 text-primary-foreground/80"
          : "border-muted-foreground/30 bg-background/70 text-muted-foreground",
      )}
    >
      <div className="font-medium">
        引用 {message.sender_type === "user" ? "你" : message.sender_name ?? "未知智能体"}
      </div>
      <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
