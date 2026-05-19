"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Gavel,
  Loader2,
  MessageSquareText,
  Plus,
  Send,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { DRAFT_NEW_SESSION, useChatStore } from "@multica/core/chat";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import {
  councilDetailOptions,
  councilListOptions,
  useAddCouncilParticipant,
  useAdjournCouncilSession,
  useArchiveCouncilSession,
  useCreateCouncilSession,
  useDeleteCouncilSession,
  useRemoveCouncilParticipant,
} from "@multica/core/councils";
import type {
  Agent,
  CouncilActivityLevel,
  CouncilSession,
  CouncilSessionParticipant,
} from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { PageHeader } from "../layout/page-header";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";

export function CouncilsPage() {
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();

  const sessionsQuery = useQuery(councilListOptions(wsId, "active"));
  const agentsQuery = useQuery(agentListOptions(wsId));
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((a) => !a.archived_at),
    [agentsQuery.data],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedSession = useMemo(
    () => (selectedId ? sessions.find((s) => s.id === selectedId) ?? null : null),
    [sessions, selectedId],
  );

  const detailQuery = useQuery({
    ...councilDetailOptions(wsId, selectedSession?.id ?? ""),
    enabled: !!selectedSession,
  });
  const participants = detailQuery.data?.participants ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <PageHeader className="gap-1.5">
        <WorkspaceAvatar name={workspace?.name ?? "O"} size="sm" />
        <span className="text-sm text-muted-foreground">Origin</span>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="text-sm font-medium">会议室</span>
        {selectedSession ? (
          <>
            <ChevronRight className="size-3 text-muted-foreground" />
            <span className="text-sm font-medium">会议详情</span>
          </>
        ) : null}
      </PageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {selectedSession ? (
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setSelectedId(null)}>
                  <ChevronLeft className="size-4" />
                  返回会议列表
                </Button>
                <h1 className="mt-1 line-clamp-2 text-lg font-semibold">{selectedSession.topic}</h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={selectedSession.status === "running" ? "default" : "secondary"}>
                  {labelForStatus(selectedSession.status)}
                </Badge>
                <Badge variant="outline">{labelForActivity(selectedSession.activity_level)}</Badge>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
              <section className="flex flex-col gap-4">
                <SessionInteractionPanel
                  session={selectedSession}
                  participants={participants}
                  agents={agents}
                  loading={detailQuery.isLoading}
                />
              </section>

              <aside className="space-y-4">
                <SessionDetailPanel
                  session={selectedSession}
                  participants={participants}
                  agents={agents}
                  loading={detailQuery.isLoading}
                />
              </aside>
            </div>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
            <section className="flex flex-col gap-4">
              <div>
                <h1 className="text-lg font-semibold">会议室</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  从列表进入会议后，再发言、追问、加人和散会。
                </p>
              </div>
              <SessionsList
                sessions={sessions}
                loading={sessionsQuery.isLoading}
                selectedId={null}
                onSelect={setSelectedId}
              />
            </section>

            <aside className="order-first space-y-4 lg:order-none">
              <ConveneSession agents={agents} onCreated={setSelectedId} />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Convene
// ────────────────────────────────────────────────────────────────────────

function ConveneSession({
  agents,
  onCreated,
}: {
  agents: Agent[];
  onCreated?: (sessionId: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [activityLevel, setActivityLevel] = useState<CouncilActivityLevel>("concise");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const create = useCreateCouncilSession();

  const submit = async () => {
    const trimmed = topic.trim();
    if (!trimmed) return;
    try {
      const created = await create.mutateAsync({
        topic: trimmed,
        activity_level: activityLevel,
        participant_agent_ids: selectedAgentIds,
      });
      setTopic("");
      setSelectedAgentIds([]);
      onCreated?.(created.session.id);
      toast.success("会议室已开");
    } catch (err) {
      toast.error("召开失败", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
    );
  };

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Users className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold">新建会议</h2>
            <p className="text-sm text-muted-foreground">填写议题，选择参会 Agent。</p>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <Textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="议题：要让多个角色对齐什么？"
          rows={2}
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">活跃度：</span>
          {(["quiet", "concise", "lively"] as const).map((lv) => (
            <Button
              key={lv}
              size="sm"
              variant={activityLevel === lv ? "default" : "outline"}
              onClick={() => setActivityLevel(lv)}
            >
              {labelForActivity(lv)}
            </Button>
          ))}
        </div>

        <div>
          <div className="mb-2 text-xs text-muted-foreground">参会角色（可选）：</div>
          <div className="flex flex-wrap gap-2">
            {agents.length === 0 ? (
              <span className="text-xs text-muted-foreground">还没有可选 Agent</span>
            ) : (
              agents.map((agent) => (
                <Button
                  key={agent.id}
                  size="sm"
                  variant={selectedAgentIds.includes(agent.id) ? "default" : "outline"}
                  onClick={() => toggleAgent(agent.id)}
                >
                  {agent.name}
                </Button>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={!topic.trim() || create.isPending}>
            {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            召开会议
          </Button>
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// List
// ────────────────────────────────────────────────────────────────────────

function SessionsList({
  sessions,
  loading,
  selectedId,
  onSelect,
}: {
  sessions: CouncilSession[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </section>
    );
  }
  if (sessions.length === 0) {
    return (
      <section className="rounded-lg border bg-card p-8 text-center">
        <Users className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          还没有会议。写一个议题、选几个 Agent 就能开。
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-sm font-semibold">会议列表</h2>
        <Badge variant="outline">{sessions.length}</Badge>
      </div>
      <ul className="divide-y">
        {sessions.map((s) => (
          <li
            key={s.id}
            className={cn(
              "cursor-pointer p-4 transition-colors hover:bg-muted/40",
              selectedId === s.id && "bg-muted/60",
            )}
            onClick={() => onSelect(s.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.topic}</div>
                {s.summary ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.summary}</p>
                ) : null}
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={s.status === "running" ? "default" : "secondary"} className="text-[10px]">
                    {labelForStatus(s.status)}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {labelForActivity(s.activity_level)}
                  </Badge>
                  <span className="ml-auto">{formatRelativeTime(s.updated_at)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 pt-0.5 text-xs font-medium text-muted-foreground">
                进入会议
                <ChevronRight className="size-3" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Interaction
// ────────────────────────────────────────────────────────────────────────

function SessionInteractionPanel({
  session,
  participants,
  agents,
  loading,
}: {
  session: CouncilSession | null;
  participants: CouncilSessionParticipant[];
  agents: Agent[];
  loading: boolean;
}) {
  const [draft, setDraft] = useState("");

  if (!session) {
    return (
      <section className="rounded-lg border bg-card p-6 text-center">
        <MessageSquareText className="mx-auto size-7 text-muted-foreground" />
        <h2 className="mt-3 text-sm font-semibold">发言 / 追问</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          先召开一个会议，然后在这里选择参会 Agent 发言。
        </p>
      </section>
    );
  }

  const activeParticipants = participants.filter((p) => !p.left_at);
  const canSpeak = session.status === "running" && activeParticipants.length > 0;
  const openAgentChat = (agentId: string) => {
    const name = agentNameById(agents, agentId);
    openCouncilAgentChat(session, agentId, name, draft);
    setDraft("");
  };

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">发言 / 追问</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            写一句要带进会议的话，再选择一个参会 Agent。消息会在 Direct Chat 中打开，带上当前会议上下文。
          </p>
        </div>
        <Badge variant={session.status === "running" ? "default" : "secondary"}>
          {labelForStatus(session.status)}
        </Badge>
      </div>
      <div className="space-y-3 p-4">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : activeParticipants.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            还没有参会 Agent。先在右侧加人，再开始发言。
          </div>
        ) : (
          <>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="例如：请从产品、前端、测试三个角度判断这个方案有什么风险？"
              rows={3}
              disabled={!canSpeak}
            />
            <div className="flex flex-wrap gap-2">
              {activeParticipants.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant="outline"
                  disabled={!canSpeak}
                  onClick={() => openAgentChat(p.agent_id)}
                >
                  <Send className="size-3.5" />
                  向 {agentNameById(agents, p.agent_id)} 发言
                </Button>
              ))}
            </div>
          </>
        )}
        {session.status !== "running" ? (
          <p className="text-xs text-muted-foreground">
            会议已散会，只保留归档、删除和结论查看。
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Detail
// ────────────────────────────────────────────────────────────────────────

function SessionDetailPanel({
  session,
  participants,
  agents,
  loading,
}: {
  session: CouncilSession | null;
  participants: CouncilSessionParticipant[];
  agents: Agent[];
  loading: boolean;
}) {
  const adjourn = useAdjournCouncilSession();
  const archive = useArchiveCouncilSession();
  const del = useDeleteCouncilSession();
  const addParticipant = useAddCouncilParticipant();
  const removeParticipant = useRemoveCouncilParticipant();

  const [conclusion, setConclusion] = useState("");

  if (!session) {
    return (
      <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        选一个会议室，这里看议题、参会角色和散会结论。
      </section>
    );
  }

  const activeParticipants = participants.filter((p) => !p.left_at);
  const availableAgents = agents.filter((a) => !activeParticipants.some((p) => p.agent_id === a.id));

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <div className="text-sm font-semibold">{session.topic}</div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <Badge variant={session.status === "running" ? "default" : "secondary"}>
            {labelForStatus(session.status)}
          </Badge>
          <Badge variant="outline">{labelForActivity(session.activity_level)}</Badge>
        </div>
        {session.summary ? (
          <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{session.summary}</p>
        ) : null}
        {session.conclusion ? (
          <div className="mt-3 rounded-md border bg-muted/40 p-2 text-xs">
            <div className="mb-1 font-semibold text-muted-foreground">会议结论</div>
            <p className="whitespace-pre-wrap">{session.conclusion}</p>
          </div>
        ) : null}
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold text-muted-foreground">
          参会角色 ({activeParticipants.length})
        </div>
        {loading ? (
          <Skeleton className="h-8 w-full" />
        ) : activeParticipants.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有参会者，下方可以加。</p>
        ) : (
          <ul className="space-y-1">
            {activeParticipants.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border bg-background p-2 text-xs">
                <span className="flex items-center gap-2">
                  <CircleDot className="size-3" />
                  {agentNameById(agents, p.agent_id)}
                  {p.role === "convener" ? <Badge variant="outline" className="text-[10px]">召集人</Badge> : null}
                </span>
                {session.status === "running" ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        openCouncilAgentChat(
                          session,
                          p.agent_id,
                          agentNameById(agents, p.agent_id),
                        )
                      }
                    >
                      <MessageSquareText className="size-3" />
                      发言
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await removeParticipant.mutateAsync({ sessionId: session.id, agentId: p.agent_id });
                        } catch (err) {
                          toast.error("移除失败", { description: err instanceof Error ? err.message : String(err) });
                        }
                      }}
                    >
                      <UserMinus className="size-3" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {session.status === "running" && availableAgents.length > 0 ? (
          <div className="mt-2">
            <div className="mb-1 text-xs text-muted-foreground">加人：</div>
            <div className="flex flex-wrap gap-1">
              {availableAgents.map((a) => (
                <Button
                  key={a.id}
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await addParticipant.mutateAsync({ sessionId: session.id, agent_id: a.id });
                    } catch (err) {
                      toast.error("加人失败", { description: err instanceof Error ? err.message : String(err) });
                    }
                  }}
                >
                  <UserPlus className="size-3" />
                  {a.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {session.status === "running" ? (
        <div className="border-t pt-3">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">散会</div>
          <Textarea
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            placeholder="可选：写一句话结论（共识 / 分歧 / 下一步）"
            rows={2}
          />
          <Button
            size="sm"
            variant="default"
            className="mt-2 w-full"
            disabled={adjourn.isPending}
            onClick={async () => {
              try {
                await adjourn.mutateAsync({ id: session.id, conclusion: conclusion.trim() || undefined });
                setConclusion("");
                toast.success("已散会");
              } catch (err) {
                toast.error("散会失败", { description: err instanceof Error ? err.message : String(err) });
              }
            }}
          >
            {adjourn.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Gavel className="size-3.5" />}
            散会
          </Button>
        </div>
      ) : null}

      <div className="flex gap-2 border-t pt-3">
        <Button
          size="sm"
          variant="ghost"
          className="flex-1"
          disabled={archive.isPending}
          onClick={async () => {
            try {
              await archive.mutateAsync(session.id);
              toast.success("已归档");
            } catch (err) {
              toast.error("归档失败", { description: err instanceof Error ? err.message : String(err) });
            }
          }}
        >
          <Archive className="size-3.5" />
          归档
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 text-destructive hover:text-destructive"
          onClick={async () => {
            if (!window.confirm(`删除会议室「${session.topic}」？`)) return;
            try {
              await del.mutateAsync(session.id);
              toast.success("已删除");
            } catch (err) {
              toast.error("删除失败", { description: err instanceof Error ? err.message : String(err) });
            }
          }}
        >
          <Trash2 className="size-3.5" />
          删除
        </Button>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function labelForActivity(level: CouncilActivityLevel): string {
  switch (level) {
    case "quiet":
      return "静默";
    case "concise":
      return "精简";
    case "lively":
      return "活跃";
  }
}

function labelForStatus(status: CouncilSession["status"]): string {
  switch (status) {
    case "running":
      return "进行中";
    case "adjourned":
      return "已散会";
    case "archived":
      return "已归档";
  }
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString();
}

function agentNameById(agents: Agent[], id: string): string {
  return agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);
}

function openCouncilAgentChat(
  session: CouncilSession,
  agentId: string,
  agentName: string,
  userDraft = "",
) {
  const trimmedDraft = userDraft.trim();
  const prompt = [
    `会议室议题：${session.topic}`,
    "",
    `请以「${agentName}」身份参与这场会议。`,
    trimmedDraft
      ? `我的发言：${trimmedDraft}`
      : "请先围绕这个议题给出你的判断、主要风险和下一步建议。",
  ].join("\n");

  const chat = useChatStore.getState();
  chat.setSelectedAgentId(agentId);
  chat.setActiveSession(null);
  chat.setInputDraft(DRAFT_NEW_SESSION, prompt);
  chat.setOpen(true);
  toast.success(`已打开 ${agentName} 的 Direct Chat`);
}
