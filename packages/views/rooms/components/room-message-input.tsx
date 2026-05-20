"use client";

import { useRef, useState } from "react";
import { cn } from "@multica/ui/lib/utils";
import { useSendRoomMessage } from "@multica/core/rooms";

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
    sendMessage.mutate({ content });
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
        "mx-5 mb-4 rounded-xl border transition-shadow",
        isFocused
          ? "border-[var(--living-accent-blue,#1677FF)] shadow-[0_0_0_2px_rgba(22,119,255,0.1)]"
          : "border-[var(--living-border-line,#E8E8E8)]",
      )}
      style={{ background: "#FFFFFF" }}
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
        className="w-full resize-none rounded-t-xl px-4 py-3 text-sm outline-none"
        style={{
          fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
          color: "var(--living-text-primary, #1F2329)",
          background: "transparent",
        }}
      />
      {(isFocused || value) && (
        <div className="flex items-center justify-end px-3 pb-2.5 gap-2">
          <span className="text-[11px]" style={{ color: "var(--living-text-secondary, #86909C)" }}>
            ⏎ 发送 · ⇧⏎ 换行
          </span>
          <button
            type="button"
            onClick={handleSend}
            disabled={!value.trim() || sendMessage.isPending}
            className="text-xs px-3 py-1 rounded-lg transition-colors disabled:opacity-40"
            style={{
              background: "var(--living-accent-blue, #1677FF)",
              color: "#FFFFFF",
            }}
          >
            {sendMessage.isPending ? "发送中…" : "发送"}
          </button>
        </div>
      )}
    </div>
  );
}
