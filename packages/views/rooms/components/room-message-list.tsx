"use client";

import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";
import { useAutoScroll } from "@multica/ui/hooks/use-auto-scroll";
import { roomMessagesOptions } from "@multica/core/rooms";
import { RoomMessageBubble } from "./room-message-bubble";
import { Skeleton } from "@multica/ui/components/ui/skeleton";

interface RoomMessageListProps {
  roomId: string;
}

export function RoomMessageList({ roomId }: RoomMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeStyle = useScrollFade(scrollRef);
  useAutoScroll(scrollRef);

  const { data, isPending, isError, refetch } = useQuery(roomMessagesOptions(roomId));
  const messages = data?.messages ?? [];

  if (isPending) {
    return (
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-3xl px-5 py-4 space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-8 w-48 rounded-lg" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3.5 w-5/6" />
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center px-5 text-center">
        <div className="max-w-sm">
          <p className="text-sm font-medium text-foreground">消息加载失败</p>
          <p className="mt-1 text-xs text-muted-foreground">
            网络或后端暂时不可用，稍后重试。
          </p>
          <button
            type="button"
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
            onClick={() => void refetch()}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p
          className="text-sm text-center"
          style={{ color: "var(--living-text-secondary, #86909C)" }}
        >
          茶水间里还很安静，发一条消息开始聊吧
        </p>
      </div>
    );
  }

  let prevSenderId: string | null = null;

  return (
    <div ref={scrollRef} style={fadeStyle} className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-4 space-y-0">
        {messages.map((msg) => {
          const isMerged = msg.sender_id === prevSenderId;
          prevSenderId = msg.sender_id;
          return (
            <RoomMessageBubble key={msg.id} message={msg} isMerged={isMerged} />
          );
        })}
      </div>
    </div>
  );
}
