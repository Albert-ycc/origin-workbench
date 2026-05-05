"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Crown,
  Loader2,
  MoreHorizontal,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { useAuthStore } from "@multica/core/auth";
import { api } from "@multica/core/api";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import {
  teamDetailOptions,
  teamKeys,
  teamMessagesOptions,
  useDeleteTeam,
  usePostTeamMessage,
} from "@multica/core/teams";
import type { Agent, Issue, TeamMessage } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";
import { PageHeader } from "../layout/page-header";
import { ActorAvatar } from "../common/actor-avatar";
import { AppLink, useNavigation } from "../navigation";

interface TeamDetailPageProps {
  teamId: string;
}

export function TeamDetailPage({ teamId }: TeamDetailPageProps) {
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();
  const wsPaths = useWorkspacePaths();
  const navigation = useNavigation();
  const currentUser = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const teamQuery = useQuery(teamDetailOptions(wsId, teamId));
  const team = teamQuery.data;
  // Refresh is WS-driven via use-realtime-sync's `team:*` prefix
  // invalidation; no polling needed.
  const { data: messagePage } = useQuery({
    ...teamMessagesOptions(wsId, teamId),
    enabled: !!team,
  });
  const messages = messagePage?.messages ?? [];
  const [loadingOlder, setLoadingOlder] = useState(false);
  const postMessage = usePostTeamMessage();
  const deleteTeam = useDeleteTeam();

  const agentById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  const captain = team ? agentById.get(team.captain_agent_id) : undefined;
  const memberAgents = useMemo(() => {
    if (!team) return [];
    return team.members
      .filter((m) => m.role !== "captain")
      .map((m) => agentById.get(m.agent_id))
      .filter((a): a is Agent => !!a);
  }, [team, agentById]);

  if (teamQuery.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader>
          <Button
            size="sm"
            variant="ghost"
            render={<AppLink href={wsPaths.teams()} />}
          >
            <ChevronLeft className="size-3.5" />
            团队
          </Button>
        </PageHeader>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          这个团队不存在或已被删除。
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-1.5 text-muted-foreground"
          render={<AppLink href={wsPaths.teams()} />}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <WorkspaceAvatar name={workspace?.name ?? "W"} size="sm" />
        <span className="text-sm text-muted-foreground">
          {workspace?.name ?? "工作区"}
        </span>
        <ChevronRight className="size-3 text-muted-foreground" />
        <AppLink
          href={wsPaths.teams()}
          className="text-sm text-muted-foreground hover:underline"
        >
          团队
        </AppLink>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{team.name}</span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            disabled={deleteTeam.isPending}
            onClick={() => {
              if (confirm(`确定要解散「${team.name}」吗？`)) {
                deleteTeam.mutate(team.id, {
                  onSuccess: () => {
                    toast.success("团队已解散");
                    navigation.push(wsPaths.teams());
                  },
                  onError: (err) => {
                    toast.error(err instanceof Error ? err.message : "解散失败");
                  },
                });
              }
            }}
          >
            <MoreHorizontal className="size-3.5" />
            解散
          </Button>
        </div>
      </PageHeader>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
        <ChatPane
          team={team}
          messages={messages}
          captain={captain}
          memberAgents={memberAgents}
          agentById={agentById}
          currentUserId={currentUser?.id ?? null}
          isSending={postMessage.isPending}
          hasOlder={!!messagePage?.next_cursor}
          loadingOlder={loadingOlder}
          onLoadOlder={async () => {
            if (!messagePage?.next_cursor) return;
            setLoadingOlder(true);
            try {
              const older = await api.listTeamMessages(team.id, {
                before: messagePage.next_cursor,
              });
              qc.setQueryData(
                teamKeys.messages(wsId, team.id),
                {
                  messages: [...older.messages, ...messages],
                  next_cursor: older.next_cursor ?? null,
                },
              );
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "加载更早消息失败");
            } finally {
              setLoadingOlder(false);
            }
          }}
          onSend={(content) => {
            const trimmed = content.trim();
            if (!trimmed) return;
            if (!currentUser) {
              toast.error("请先登录");
              return;
            }
            postMessage.mutate(
              { teamId: team.id, content: trimmed },
              {
                onError: (err) => {
                  toast.error(
                    err instanceof Error ? err.message : "发送失败",
                  );
                },
              },
            );
          }}
        />
        <RosterPane
          captain={captain}
          memberAgents={memberAgents}
          description={team.description}
        />
      </div>
    </div>
  );
}

interface MentionOption {
  key: string; // "all" | agent.id
  display: string; // text inserted (without leading @)
  label: string; // human-readable header
  hint: string; // descriptor row
  searchable: string; // lowercased haystack
}

interface MentionState {
  triggerStart: number; // index in draft of the `@` itself
  query: string;
  selectedIndex: number;
}

// Decide whether a `@` at position `at` (just before the caret) should open
// the picker. Trigger when the char before `@` is start-of-string or
// whitespace — otherwise the user is typing an email address or similar.
function shouldOpenMention(value: string, at: number): boolean {
  if (at < 0 || value[at] !== "@") return false;
  if (at === 0) return true;
  const prev = value[at - 1];
  return prev === " " || prev === "\n" || prev === "\t";
}

export function ChatPane({
  team,
  messages,
  captain,
  memberAgents,
  agentById,
  currentUserId,
  isSending,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onSend,
  onPin,
}: {
  team: { id: string; name: string };
  messages: TeamMessage[];
  captain: Agent | undefined;
  memberAgents: Agent[];
  agentById: Map<string, Agent>;
  currentUserId: string | null;
  isSending: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onSend: (content: string) => void;
  // PRD §17.4.2 — when present, each message renders a "钉到记忆" action.
  // Project workspace passes this; team room (no project_id) leaves undefined.
  onPin?: (message: TeamMessage) => void;
}) {
  const [draft, setDraft] = useState("");
  const [mention, setMention] = useState<MentionState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // "Captain is thinking" indicator: visible whenever the most recent
  // message is from a user (server hasn't enqueued the assistant row yet)
  // OR the send mutation is in-flight. Cleared automatically when the
  // assistant row lands via WS-driven invalidate.
  const lastMessage = messages[messages.length - 1];
  const awaitingCaptain =
    !!captain && (isSending || lastMessage?.role === "user");

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, awaitingCaptain]);

  const allMembers: MentionOption[] = useMemo(() => {
    const opts: MentionOption[] = [
      {
        key: "all",
        display: "全体",
        label: "@全体",
        hint: "通知所有团队成员",
        searchable: "全体 all everyone team",
      },
    ];
    if (captain) {
      opts.push({
        key: captain.id,
        display: captain.name,
        label: captain.name,
        hint: "负责人",
        searchable: `${captain.name} captain`.toLowerCase(),
      });
    }
    for (const m of memberAgents) {
      opts.push({
        key: m.id,
        display: m.name,
        label: m.name,
        hint: "成员",
        searchable: `${m.name} member`.toLowerCase(),
      });
    }
    return opts;
  }, [captain, memberAgents]);

  const filteredOptions = useMemo(() => {
    if (!mention) return [] as MentionOption[];
    const q = mention.query.trim().toLowerCase();
    if (!q) return allMembers;
    return allMembers.filter((opt) => opt.searchable.includes(q));
  }, [mention, allMembers]);

  // Boundary: filtering can collapse the option list. Snap selectedIndex
  // back into range silently so a stale index never mismatches the row
  // about to be rendered (and accepted via Enter).
  useEffect(() => {
    if (!mention) return;
    if (mention.selectedIndex >= filteredOptions.length) {
      setMention((m) =>
        m ? { ...m, selectedIndex: Math.max(0, filteredOptions.length - 1) } : m,
      );
    }
  }, [mention, filteredOptions.length]);

  const updateDraft = (next: string, caret: number) => {
    setDraft(next);
    // Detect or update mention based on the char left of the caret.
    let lastAt = -1;
    for (let i = caret - 1; i >= 0; i--) {
      const ch = next[i];
      if (ch === "@") {
        lastAt = i;
        break;
      }
      if (ch === " " || ch === "\n" || ch === "\t") break;
    }
    if (lastAt < 0 || !shouldOpenMention(next, lastAt)) {
      if (mention) setMention(null);
      return;
    }
    const query = next.slice(lastAt + 1, caret);
    setMention((prev) => ({
      triggerStart: lastAt,
      query,
      selectedIndex: prev?.triggerStart === lastAt ? prev.selectedIndex : 0,
    }));
  };

  const acceptMention = (option: MentionOption) => {
    if (!mention) return;
    const before = draft.slice(0, mention.triggerStart);
    const after = draft.slice(mention.triggerStart + 1 + mention.query.length);
    const inserted = `@${option.display} `;
    const next = before + inserted + after;
    setDraft(next);
    setMention(null);
    // Restore caret right after the inserted token. Defer until after the
    // textarea re-renders with the new value.
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = before.length + inserted.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const submit = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
    setMention(null);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <EmptyChat captain={captain} memberAgents={memberAgents} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {hasOlder && (
              <div className="flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingOlder}
                  onClick={onLoadOlder}
                >
                  {loadingOlder ? "加载中…" : "加载更早消息"}
                </Button>
              </div>
            )}
            {messages.map((m) => (
              <Message
                key={m.id}
                message={m}
                isMe={m.role === "user" && !!currentUserId}
                agent={
                  m.role === "assistant" && m.sender_agent_id
                    ? agentById.get(m.sender_agent_id)
                    : undefined
                }
                isCaptain={
                  m.role === "assistant" &&
                  m.sender_agent_id === captain?.id
                }
                agentById={agentById}
                onPin={onPin}
              />
            ))}
            {awaitingCaptain && captain && (
              <CaptainTypingRow captain={captain} />
            )}
          </div>
        )}
      </div>

      <div className="border-t bg-background px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <div className="relative flex-1">
            {mention && filteredOptions.length > 0 && (
              <MentionMenu
                options={filteredOptions}
                selectedIndex={mention.selectedIndex}
                onPick={acceptMention}
                captainId={captain?.id ?? null}
              />
            )}
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) =>
                updateDraft(e.target.value, e.target.selectionStart ?? 0)
              }
              onClick={(e) => {
                const ta = e.currentTarget;
                updateDraft(ta.value, ta.selectionStart ?? 0);
              }}
              onKeyDown={(e) => {
                if (mention && filteredOptions.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMention((m) =>
                      m
                        ? {
                            ...m,
                            selectedIndex:
                              (m.selectedIndex + 1) % filteredOptions.length,
                          }
                        : m,
                    );
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMention((m) =>
                      m
                        ? {
                            ...m,
                            selectedIndex:
                              (m.selectedIndex - 1 + filteredOptions.length) %
                              filteredOptions.length,
                          }
                        : m,
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
                  submit();
                }
              }}
              placeholder={`和「${team.name}」说点什么…  输入 @ 提及成员 / Enter 发送 / Shift+Enter 换行`}
              rows={2}
              className="resize-none"
            />
          </div>
          <Button
            disabled={!draft.trim()}
            onClick={submit}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function MentionMenu({
  options,
  selectedIndex,
  onPick,
  captainId,
}: {
  options: MentionOption[];
  selectedIndex: number;
  onPick: (opt: MentionOption) => void;
  captainId: string | null;
}) {
  return (
    <div
      className="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
      role="listbox"
    >
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        提及
      </div>
      {options.map((opt, i) => {
        const isSelected = i === selectedIndex;
        const isAgent = opt.key !== "all";
        return (
          <button
            key={opt.key}
            type="button"
            role="option"
            aria-selected={isSelected}
            // Use onMouseDown so the click registers before the textarea
            // loses focus & the click → blur race closes the menu first.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(opt);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              isSelected ? "bg-muted" : "hover:bg-muted/60",
            )}
          >
            {isAgent ? (
              <ActorAvatar
                actorType="agent"
                actorId={opt.key}
                size={24}
                className="rounded-full"
              />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                ALL
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate text-sm">{opt.label}</span>
                {opt.key === captainId && (
                  <Crown className="size-3 shrink-0 text-primary" />
                )}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {opt.hint}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CaptainTypingRow({ captain }: { captain: Agent }) {
  return (
    <div className="flex gap-2">
      <ActorAvatar
        actorType="agent"
        actorId={captain.id}
        size={32}
        className="mt-0.5 rounded-full"
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{captain.name}</span>
          <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            <Crown className="size-3" />
            负责人
          </span>
          <span>正在思考…</span>
        </div>
        <div className="inline-flex items-center gap-1 rounded-2xl bg-muted px-3 py-2">
          <TypingDot delay="0ms" />
          <TypingDot delay="160ms" />
          <TypingDot delay="320ms" />
        </div>
      </div>
    </div>
  );
}

function TypingDot({ delay }: { delay: string }) {
  return (
    <span
      className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60"
      style={{ animationDelay: delay }}
    />
  );
}

function Message({
  message,
  isMe,
  agent,
  isCaptain,
  agentById,
  onPin,
}: {
  message: TeamMessage;
  isMe: boolean;
  agent: Agent | undefined;
  isCaptain: boolean;
  agentById?: Map<string, Agent>;
  onPin?: (m: TeamMessage) => void;
}) {
  if (message.role === "assistant" && !message.sender_agent_id) {
    return (
      <div className="flex justify-center">
        <span className="max-w-[80%] rounded-full border bg-muted/60 px-3 py-1 text-center text-xs text-muted-foreground">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-2",
        isMe ? "flex-row-reverse" : "flex-row",
      )}
    >
      {message.role === "assistant" && agent ? (
        <ActorAvatar
          actorType="agent"
          actorId={agent.id}
          size={32}
          className="mt-0.5 rounded-full"
        />
      ) : (
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
          我
        </div>
      )}
      <div className={cn("group flex max-w-[75%] flex-col gap-1", isMe && "items-end")}>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            {message.role === "assistant" ? agent?.name ?? "未知" : "你"}
          </span>
          {isCaptain && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              <Crown className="size-3" />
              负责人
            </span>
          )}
          <span>{formatTime(message.created_at)}</span>
          {onPin && (
            <button
              type="button"
              onClick={() => onPin(message)}
              className="ml-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
              title="钉到项目记忆「用户钉住的片段」"
            >
              📌 钉
            </button>
          )}
        </div>
        <div
          className={cn(
            "whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
            isMe
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground",
          )}
        >
          {message.content}
        </div>
        {/* D 方案: captain 派活的任务卡片挂在 captain reply 下面 */}
        {isCaptain && agentById && (
          <TeamTaskCardList messageId={message.id} agentById={agentById} />
        )}
      </div>
    </div>
  );
}

// 群聊任务卡片清单 — 反查 captain 这条 message 派出了哪些 issue（v1.2 D
// 方案）。每张卡片显示 assignee + 任务标题 + 状态 chip。
function TeamTaskCardList({
  messageId,
  agentById,
}: {
  messageId: string;
  agentById: Map<string, Agent>;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["issues", "by-team-message", messageId],
    queryFn: () => api.listIssuesByTeamMessage(messageId),
    select: (r) => r.issues,
    // captain reply 一发完，后端 hook 几秒内创建 issue。聚焦窗口时刷一下，
    // 避免用户在前台等了 30s 还看不到任务卡片。
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data;
      const issues = data?.issues;
      if (!issues || issues.length === 0) return 4000;
      // 还有任何任务没到终态就继续轮询
      const allDone = issues.every(
        (i: Issue) =>
          i.status === "done" ||
          i.status === "in_review" ||
          i.status === "cancelled",
      );
      return allDone ? false : 4000;
    },
  });
  if (isLoading || !data || data.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
        派出的任务 · {data.length} 张
      </div>
      <div className="flex flex-col gap-1">
        {data.map((issue) => (
          <TeamTaskCard
            key={issue.id}
            issue={issue}
            assignee={
              issue.assignee_id ? agentById.get(issue.assignee_id) : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

const taskStatusMeta: Record<
  string,
  { label: string; tone: string; icon: typeof Circle }
> = {
  todo: { label: "等待中", tone: "text-muted-foreground bg-muted/60", icon: Circle },
  in_progress: { label: "处理中", tone: "text-amber-500 bg-amber-500/10", icon: Loader2 },
  in_review: { label: "已回报", tone: "text-emerald-500 bg-emerald-500/10", icon: CheckCircle2 },
  done: { label: "已完成", tone: "text-emerald-500 bg-emerald-500/10", icon: CheckCircle2 },
  blocked: { label: "卡点", tone: "text-destructive bg-destructive/10", icon: Clock3 },
  cancelled: { label: "已取消", tone: "text-muted-foreground bg-muted/60", icon: Circle },
  backlog: { label: "待办", tone: "text-muted-foreground bg-muted/60", icon: Circle },
};

function TeamTaskCard({
  issue,
  assignee,
}: {
  issue: Issue;
  assignee: Agent | undefined;
}) {
  const meta = taskStatusMeta[issue.status] ?? taskStatusMeta.todo!;
  const Icon = meta.icon;
  const isRunning = issue.status === "in_progress";
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background/60 px-2.5 py-1.5">
      {assignee ? (
        <ActorAvatar
          actorType="agent"
          actorId={assignee.id}
          size={20}
          className="shrink-0 rounded-full"
        />
      ) : (
        <div className="size-5 shrink-0 rounded-full bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium">
            {assignee?.name ?? "未指派"}
          </span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {issue.title}
        </div>
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
          meta.tone,
        )}
      >
        <Icon className={cn("size-3", isRunning && "animate-spin")} />
        {meta.label}
      </span>
    </div>
  );
}

function EmptyChat({
  captain,
  memberAgents,
}: {
  captain: Agent | undefined;
  memberAgents: Agent[];
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center pt-16 text-center">
      <div className="flex -space-x-3">
        {captain && (
          <ActorAvatar
            actorType="agent"
            actorId={captain.id}
            size={56}
            className="rounded-full ring-2 ring-card"
          />
        )}
        {memberAgents.slice(0, 4).map((a) => (
          <ActorAvatar
            key={a.id}
            actorType="agent"
            actorId={a.id}
            size={48}
            className="rounded-full ring-2 ring-card"
          />
        ))}
      </div>
      <h2 className="mt-5 text-base font-semibold">这里是团队群聊</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        发一条消息即可，
        {captain ? <>负责人「{captain.name}」</> : <>负责人</>}
        会先确认，再决定派活给谁。
      </p>
      <p className="mt-1 text-xs text-muted-foreground/70">
        可以输入 @ 提及成员；当前会先派发给负责人，由负责人判断是否拆给其它智能体。
      </p>
    </div>
  );
}

function RosterPane({
  captain,
  memberAgents,
  description,
}: {
  captain: Agent | undefined;
  memberAgents: Agent[];
  description: string;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-l bg-card">
      <div className="border-b p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Users className="size-3.5" />
          团队
        </div>
        {description && (
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {captain && (
          <div className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            负责人
          </div>
        )}
        {captain && (
          <RosterRow agent={captain} role="captain" />
        )}
        {memberAgents.length > 0 && (
          <div className="mb-1.5 mt-3 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            成员 · {memberAgents.length}
          </div>
        )}
        {memberAgents.map((a) => (
          <RosterRow key={a.id} agent={a} role="member" />
        ))}
      </div>
    </aside>
  );
}

function RosterRow({
  agent,
  role,
}: {
  agent: Agent;
  role: "captain" | "member";
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/60">
      <ActorAvatar
        actorType="agent"
        actorId={agent.id}
        size={28}
        className="rounded-full"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-sm">{agent.name}</span>
          {role === "captain" && (
            <Crown className="size-3 shrink-0 text-primary" />
          )}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {agent.description || "暂无描述"}
        </div>
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
