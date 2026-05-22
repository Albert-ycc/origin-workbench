"use client";

import { useRef, useState } from "react";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { useSendRoomMessage } from "@multica/core/rooms";
import { toast } from "sonner";

interface RoomMessageInputProps {
  roomId: string;
}

export function RoomMessageInput({ roomId }: RoomMessageInputProps) {
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useSendRoomMessage(roomId);

  const handleSend = () => {
    const content = value.trim();
    if (!content || sendMessage.isPending) return;
    setValue("");
    sendMessage.mutate(
      { content },
      {
        onError: () => {
          setValue(content);
          toast.error("发送失败，内容已保留，请稍后重试");
        },
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className={cn(
        "mx-5 mb-4 rounded-lg border bg-card transition-shadow",
        isFocused
          ? "border-ring shadow-[0_0_0_2px_hsl(var(--ring)/0.15)]"
          : "border-border",
      )}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder="说点什么…"
        rows={isFocused || value ? 3 : 1}
        className="w-full resize-none rounded-t-lg px-4 py-3 text-sm outline-none bg-transparent text-foreground placeholder:text-muted-foreground"
      />
      {(isFocused || value) && (
        <div className="flex items-center justify-end px-3 pb-2.5 gap-2">
          <span className="text-[11px] text-muted-foreground">
            ⏎ 发送 · ⇧⏎ 换行
          </span>
          <Button
            size="xs"
            onClick={handleSend}
            disabled={!value.trim() || sendMessage.isPending}
          >
            {sendMessage.isPending ? "发送中…" : "发送"}
          </Button>
        </div>
      )}
    </div>
  );
}
