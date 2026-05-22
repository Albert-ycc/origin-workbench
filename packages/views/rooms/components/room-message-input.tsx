"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { useWorkspaceId } from "@multica/core/hooks";
import { roomMembersOptions, useSendRoomMessage } from "@multica/core/rooms";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { Agent, RoomMessage } from "@multica/core/types";
import { ActorAvatar } from "@multica/views/common/actor-avatar";
import { Send, X } from "lucide-react";
import { toast } from "sonner";

interface RoomMessageInputProps {
  roomId: string;
  replyToMessage?: RoomMessage | null;
  onCancelReply?: () => void;
}

interface MentionState {
  triggerStart: number;
  query: string;
  selectedIndex: number;
}

interface MentionOption {
  key: string;
  display: string;
  label: string;
  hint: string;
  searchable: string;
}

export function RoomMessageInput({
  roomId,
  replyToMessage,
  onCancelReply,
}: RoomMessageInputProps) {
  const wsId = useWorkspaceId();
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useSendRoomMessage(roomId);
  const { data: memberPage } = useQuery(roomMembersOptions(roomId));
  const { data: agents = [] } = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId,
  });

  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const mentionOptions = useMemo(() => {
    const options: MentionOption[] = [
      {
        key: "all",
        display: "全体",
        label: "@全体",
        hint: "通知所有茶水间成员",
        searchable: "全体 all everyone room",
      },
    ];

    const seen = new Set<string>();
    for (const member of memberPage?.members ?? []) {
      if (member.member_type !== "agent") continue;
      const agentId = member.agent_id ?? member.member_id;
      if (seen.has(agentId)) continue;
      seen.add(agentId);
      const agent = agentById.get(agentId);
      options.push({
        key: agentId,
        display: agent?.name ?? agentId,
        label: agent?.name ?? agentId,
        hint: agent?.description || "茶水间成员",
        searchable: `${agent?.name ?? agentId} ${agent?.description ?? ""}`.toLowerCase(),
      });
    }
    return options;
  }, [agentById, memberPage?.members]);

  const filteredOptions = useMemo(() => {
    if (!mention) return [] as MentionOption[];
    const query = mention.query.trim().toLowerCase();
    if (!query) return mentionOptions;
    return mentionOptions.filter((option) => option.searchable.includes(query));
  }, [mention, mentionOptions]);

  useEffect(() => {
    if (!mention || mention.selectedIndex < filteredOptions.length) return;
    setMention((current) =>
      current
        ? { ...current, selectedIndex: Math.max(0, filteredOptions.length - 1) }
        : current,
    );
  }, [mention, filteredOptions.length]);

  const updateValue = (next: string, caret: number) => {
    setValue(next);
    let lastAt = -1;
    for (let i = caret - 1; i >= 0; i--) {
      const char = next[i];
      if (char === "@") {
        lastAt = i;
        break;
      }
      if (char === " " || char === "\n" || char === "\t") break;
    }
    if (lastAt >= 0 && shouldOpenMention(next, lastAt)) {
      const query = next.slice(lastAt + 1, caret);
      setMention((current) => ({
        triggerStart: lastAt,
        query,
        selectedIndex: current?.triggerStart === lastAt ? current.selectedIndex : 0,
      }));
      return;
    }
    if (mention) setMention(null);
  };

  const acceptMention = (option: MentionOption) => {
    if (!mention) return;
    const before = value.slice(0, mention.triggerStart);
    const after = value.slice(mention.triggerStart + 1 + mention.query.length);
    const inserted = `@${option.display} `;
    const next = before + inserted + after;
    setValue(next);
    setMention(null);
    setSelectedMentionIds((ids) =>
      ids.includes(option.key) ? ids : [...ids, option.key],
    );
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const position = before.length + inserted.length;
      textarea.focus();
      textarea.setSelectionRange(position, position);
    });
  };

  const handleSend = () => {
    const content = value.trim();
    if (!content || sendMessage.isPending) return;
    const mentions = selectedMentionIds.length ? selectedMentionIds : undefined;
    setValue("");
    setMention(null);
    setSelectedMentionIds([]);
    sendMessage.mutate(
      {
        content,
        ...(replyToMessage ? { reply_to_message_id: replyToMessage.id } : {}),
        ...(mentions ? { mentions, mention_agent_ids: mentions } : {}),
      },
      {
        onError: () => {
          setValue(content);
          setSelectedMentionIds(mentions ?? []);
          toast.error("发送失败，内容已保留，请稍后重试");
        },
        onSuccess: () => {
          if (replyToMessage) onCancelReply?.();
        },
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && filteredOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention((current) =>
          current
            ? {
                ...current,
                selectedIndex: (current.selectedIndex + 1) % filteredOptions.length,
              }
            : current,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention((current) =>
          current
            ? {
                ...current,
                selectedIndex:
                  (current.selectedIndex - 1 + filteredOptions.length) %
                  filteredOptions.length,
              }
            : current,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptMention(filteredOptions[mention.selectedIndex]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="room-message-input-bar border-t px-5 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <div
          className={cn(
            "room-composer relative flex-1 rounded-lg border transition-shadow",
            isFocused
              ? "is-focused"
              : "border-border",
          )}
        >
          {mention && filteredOptions.length > 0 && (
            <MentionMenu
              options={filteredOptions}
              selectedIndex={mention.selectedIndex}
              agentById={agentById}
              onPick={acceptMention}
            />
          )}
          {replyToMessage && (
            <div className="flex items-start gap-2 border-b px-3 py-2 text-xs">
              <div className="min-w-0 flex-1 rounded-md border-l-2 border-primary/50 bg-muted/60 px-2 py-1">
                <div className="font-medium text-foreground">
                  引用 {replyToMessage.sender_type === "user"
                    ? "你"
                    : replyToMessage.sender_name ?? "未知智能体"}
                </div>
                <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-muted-foreground">
                  {replyToMessage.content}
                </div>
              </div>
              <button
                type="button"
                aria-label="取消引用"
                onClick={onCancelReply}
                className="mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => updateValue(e.target.value, e.target.selectionStart ?? 0)}
            onClick={(e) => updateValue(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="说点什么…  输入 @ 提及成员 / Enter 发送"
            rows={isFocused || value || replyToMessage ? 3 : 1}
            className="w-full resize-none rounded-lg bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Button
          size="icon"
          className="mb-1 size-10 shrink-0"
          onClick={handleSend}
          disabled={!value.trim() || sendMessage.isPending}
          aria-label="发送"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function MentionMenu({
  options,
  selectedIndex,
  agentById,
  onPick,
}: {
  options: MentionOption[];
  selectedIndex: number;
  agentById: Map<string, Agent>;
  onPick: (option: MentionOption) => void;
}) {
  return (
    <div
      className="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
      role="listbox"
    >
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        提及
      </div>
      {options.map((option, index) => {
        const isSelected = index === selectedIndex;
        const isAll = option.key === "all";
        return (
          <button
            key={option.key}
            type="button"
            role="option"
            aria-selected={isSelected}
            aria-label={`${option.label} ${option.hint}`}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(option);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              isSelected ? "bg-muted" : "hover:bg-muted/60",
            )}
          >
            {isAll ? (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                ALL
              </span>
            ) : (
              <ActorAvatar
                actorType="agent"
                actorId={option.key}
                size={24}
                className="rounded-full"
                showStatusDot
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{option.label}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {isAll ? option.hint : agentById.get(option.key)?.description || option.hint}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function shouldOpenMention(value: string, atIndex: number) {
  if (atIndex < 0) return false;
  if (atIndex === 0) return true;
  return /\s/.test(value[atIndex - 1] ?? "");
}
