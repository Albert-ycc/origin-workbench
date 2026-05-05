"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Bot, FileText, FolderOpen, Network, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { useAuthStore } from "@multica/core/auth";
import { api } from "@multica/core/api";
import {
  projectV12DetailOptions,
  projectMainChatOptions,
  projectMainChatMessagesOptions,
  projectV12Keys,
  useUpdateProjectV12,
  usePostProjectMainChatMessage,
  usePinChatMessageToProjectMemory,
  usePreviewProjectCompaction,
  useConfirmProjectCompaction,
  projectArchivedSessionsOptions,
} from "@multica/core/projects-v12";
import type { CompactionPreview, PinnedQuoteCandidate } from "@multica/core/types";
import { teamDetailOptions } from "@multica/core/teams";
import { useCreateCouncilSession } from "@multica/core/councils";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { Agent } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { cn } from "@multica/ui/lib/utils";
import { PageHeader } from "../layout/page-header";
import { ChatPane } from "../teams/team-detail-page";

// Project workspace page (PRD §17.3). Two-column layout:
//   left  — project main chat (one long timeline; reuses chat-window contract)
//   right — three tabs: 团队工作文件 / 项目记忆文档 / Mission&Idea&Exploration 列表
//
// This is the v1.2 stub: the chat column delegates to the existing chat
// surfaces (chat_session.project_id is the new linkage), and the doc column
// renders the memory_doc Markdown directly. Local file browser tab is
// scaffolded — the chokidar IPC bridge is Phase B+ work.

type DocTab = "files" | "memory" | "items" | "archive";

export function ProjectWorkspacePage({ projectId }: { projectId: string }) {
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { data: project, isLoading } = useQuery(projectV12DetailOptions(wsId, projectId));
  const { data: mainChat } = useQuery({
    ...projectMainChatOptions(wsId, projectId),
    enabled: !!project,
  });
  const { data: messagePage } = useQuery({
    ...projectMainChatMessagesOptions(wsId, projectId),
    enabled: !!mainChat,
  });
  const messages = messagePage?.messages ?? [];
  const teamId = project?.team_id ?? null;
  const { data: team } = useQuery({
    ...teamDetailOptions(wsId, teamId ?? ""),
    enabled: !!teamId,
  });
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const agentById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );
  const captain = team ? agentById.get(team.captain_agent_id) : undefined;
  const memberAgents = useMemo(() => {
    if (!team) return [] as Agent[];
    return team.members
      .filter((m) => m.role !== "captain")
      .map((m) => agentById.get(m.agent_id))
      .filter((a): a is Agent => !!a);
  }, [team, agentById]);

  const postMessage = usePostProjectMainChatMessage(wsId);
  const pinMessage = usePinChatMessageToProjectMemory(wsId);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const updateProject = useUpdateProjectV12(wsId);
  const [activeTab, setActiveTab] = useState<DocTab>("memory");
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader>
          <Skeleton className="h-5 w-48" />
        </PageHeader>
        <div className="flex flex-1 gap-4 p-4">
          <Skeleton className="flex-1 rounded-xl" />
          <Skeleton className="w-[480px] rounded-xl" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <span>项目不存在或已归档</span>
        <Button variant="outline" size="sm" onClick={() => window.history.back()}>
          返回
        </Button>
      </div>
    );
  }

  const statusTone: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-500",
    paused: "bg-amber-500/15 text-amber-500",
    completed: "bg-blue-500/15 text-blue-500",
    archived: "bg-muted text-muted-foreground",
  };
  const statusCopy: Record<string, string> = {
    active: "推进中",
    paused: "暂停",
    completed: "已完成",
    archived: "已归档",
  };

  const startEdit = () => {
    setMemoryDraft(project.memory_doc);
    setEditingMemory(true);
  };
  const saveMemory = async () => {
    await updateProject.mutateAsync({ id: project.id, data: { memory_doc: memoryDraft } });
    setEditingMemory(false);
  };

  return (
    <div className="flex flex-1 flex-col bg-background">
      <PageHeader className="gap-1.5">
        <span className="text-sm text-muted-foreground">项目工作区 / </span>
        <span className="text-sm font-medium">{project.title}</span>
        <Badge variant="secondary" className={cn("ml-2", statusTone[project.status])}>
          {statusCopy[project.status] ?? project.status}
        </Badge>
        {project.local_dir && (
          <code className="ml-2 rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {project.local_dir}
          </code>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            第 {project.compaction_count} 次压缩
          </span>
          {mainChat && (
            <ConveneCouncilButton
              projectId={projectId}
              chatSessionId={mainChat.chat_session_id}
              memberAgents={memberAgents}
              captain={captain}
            />
          )}
          <CompactionButton projectId={projectId} />
        </div>
      </PageHeader>

      <div className="flex flex-1 min-h-0">
        {/* Left: project main chat (PRD §17.3) */}
        <section className="flex flex-1 min-w-0 flex-col border-r">
          {mainChat && team ? (
            <ChatPane
              team={{ id: team.id, name: project.title }}
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
                  const older = await api.listProjectMainChatMessages(projectId, {
                    before: messagePage.next_cursor,
                  });
                  qc.setQueryData(
                    projectV12Keys.mainChatMessages(wsId, projectId),
                    {
                      messages: [...older.messages, ...messages],
                      next_cursor: older.next_cursor ?? null,
                    },
                  );
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "加载更早消息失败",
                  );
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
                  { projectId, content: trimmed },
                  {
                    onError: (err) => {
                      toast.error(
                        err instanceof Error ? err.message : "发送失败",
                      );
                    },
                  },
                );
              }}
              onPin={(message) => {
                pinMessage.mutate(
                  { projectId, messageId: message.id },
                  {
                    onSuccess: () => toast.success("已钉到项目记忆"),
                    onError: (err) =>
                      toast.error(
                        err instanceof Error ? err.message : "钉住失败",
                      ),
                  },
                );
              }}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
              <Skeleton className="h-32 w-2/3" />
            </div>
          )}
        </section>

        {/* Right: doc column */}
        <aside className="flex w-[480px] flex-col">
          <div className="flex h-11 items-center gap-1 border-b px-3">
            <DocTabBtn active={activeTab === "files"} onClick={() => setActiveTab("files")} icon={FolderOpen}>
              团队工作文件
            </DocTabBtn>
            <DocTabBtn active={activeTab === "memory"} onClick={() => setActiveTab("memory")} icon={FileText}>
              项目记忆文档
            </DocTabBtn>
            <DocTabBtn active={activeTab === "items"} onClick={() => setActiveTab("items")} icon={Network}>
              Mission · Idea
            </DocTabBtn>
            <DocTabBtn active={activeTab === "archive"} onClick={() => setActiveTab("archive")} icon={Archive}>
              会话归档
            </DocTabBtn>
          </div>

          {activeTab === "memory" && (
            <div className="flex flex-1 flex-col overflow-y-auto">
              {!editingMemory ? (
                <div className="flex-1 px-5 py-4">
                  <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {project.memory_doc_updated_at
                        ? `最近更新 · ${new Date(project.memory_doc_updated_at).toLocaleString("zh-CN")}`
                        : "尚未更新"}
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={startEdit}>
                      编辑
                    </Button>
                  </div>
                  {project.memory_doc ? (
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90">
                      {project.memory_doc}
                    </pre>
                  ) : (
                    <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
                      还没有写入项目记忆。Council 散会、Mission 完成、用户钉住片段会自动追加到这里。
                      也可以点上方「编辑」手动写一段项目目标作为开篇。
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-1 flex-col p-3 gap-2">
                  <textarea
                    className="flex-1 w-full resize-none rounded-md border bg-background p-3 font-mono text-xs leading-relaxed"
                    value={memoryDraft}
                    onChange={(e) => setMemoryDraft(e.target.value)}
                    placeholder="# 项目记忆\n\n## 项目目标\n...\n\n## 当前状态\n..."
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingMemory(false)}>
                      取消
                    </Button>
                    <Button size="sm" onClick={saveMemory} disabled={updateProject.isPending}>
                      保存
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "files" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <FolderOpen className="size-8 opacity-40" />
              <p className="text-xs leading-relaxed max-w-xs">
                本地文件浏览器接入中
                <br />
                绑定目录：<code className="font-mono text-[11px]">{project.local_dir || "（未设置）"}</code>
              </p>
            </div>
          )}

          {activeTab === "items" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <Network className="size-8 opacity-40" />
              <p className="text-xs leading-relaxed max-w-xs">
                Mission / Idea / Exploration 接入中
                <br />
                数据已迁到项目维度（mission/idea.project_id），列表渲染待 Phase B+ 实装
              </p>
            </div>
          )}

          {activeTab === "archive" && (
            <ArchivedSessionsTab projectId={projectId} />
          )}
        </aside>
      </div>
    </div>
  );
}

function ArchivedSessionsTab({ projectId }: { projectId: string }) {
  const wsId = useWorkspaceId();
  const { data, isLoading } = useQuery(projectArchivedSessionsOptions(wsId, projectId));
  const sessions = data?.sessions ?? [];
  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
        <Archive className="size-8 opacity-40" />
        <p className="text-xs leading-relaxed max-w-xs">
          还没有归档的主聊。
          <br />
          每次执行「整理 + 重新出发」时旧会话会归档到这里，可点开回看完整历史。
        </p>
      </div>
    );
  }
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3">
      {sessions.map((s, i) => (
        <div key={s.id} className="rounded-md border bg-card px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">第 {sessions.length - i} 次压缩前</span>
            {s.last_compacted_at && (
              <span className="text-muted-foreground">
                {new Date(s.last_compacted_at).toLocaleString("zh-CN")}
              </span>
            )}
          </div>
          <div className="mt-1 text-muted-foreground">{s.title || "项目主聊"}</div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            id: {s.id.slice(0, 8)}…
          </div>
        </div>
      ))}
    </div>
  );
}

function CompactionButton({ projectId }: { projectId: string }) {
  const wsId = useWorkspaceId();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CompactionPreview | null>(null);
  const [keyDecisions, setKeyDecisions] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [currentStatus, setCurrentStatus] = useState("");
  const [carryForward, setCarryForward] = useState("");
  const [pickedPins, setPickedPins] = useState<Set<string>>(new Set());
  const previewMut = usePreviewProjectCompaction();
  const confirmMut = useConfirmProjectCompaction(wsId);

  const start = async () => {
    try {
      const data = await previewMut.mutateAsync(projectId);
      setPreview(data);
      setKeyDecisions((data.key_decisions ?? []).join("\n"));
      setDeliverables((data.deliverables ?? []).join("\n"));
      setCurrentStatus(data.current_status ?? "");
      setCarryForward((data.carry_forward ?? []).join("\n"));
      setPickedPins(new Set());
      setOpen(true);
    } catch (err) {
      toast.error("无法预览压缩", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const confirm = async () => {
    try {
      await confirmMut.mutateAsync({
        projectId,
        data: {
          key_decisions: keyDecisions.split("\n").map((s) => s.trim()).filter(Boolean),
          deliverables: deliverables.split("\n").map((s) => s.trim()).filter(Boolean),
          current_status: currentStatus.trim(),
          carry_forward: carryForward.split("\n").map((s) => s.trim()).filter(Boolean),
          selected_pin_ids: Array.from(pickedPins),
        },
      });
      toast.success("项目记忆已更新，新主聊已开启");
      setOpen(false);
      setPreview(null);
    } catch (err) {
      toast.error("压缩失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const togglePin = (id: string) => {
    setPickedPins((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={start} disabled={previewMut.isPending}>
        <Sparkles className="size-3" />
        整理 + 重新出发
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>整理项目主聊（压缩预览）</DialogTitle>
          </DialogHeader>
          {!preview ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              <div className="text-[11px] text-muted-foreground">
                范围：{preview.message_count} 条消息
                {preview.oldest_at && preview.newest_at && (
                  <>
                    {" "}
                    · {new Date(preview.oldest_at).toLocaleString("zh-CN")} →{" "}
                    {new Date(preview.newest_at).toLocaleString("zh-CN")}
                  </>
                )}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium">关键决策（每行一条）</div>
                <Textarea
                  rows={3}
                  value={keyDecisions}
                  onChange={(e) => setKeyDecisions(e.target.value)}
                  placeholder="例：决定先做最小可用版本，把 LLM 智能压缩留 v1.3"
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium">主要产出（每行一条）</div>
                <Textarea
                  rows={3}
                  value={deliverables}
                  onChange={(e) => setDeliverables(e.target.value)}
                  placeholder="例：完成 Phase B 续 - 项目主聊真派发链路"
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium">当前状态</div>
                <Textarea
                  rows={2}
                  value={currentStatus}
                  onChange={(e) => setCurrentStatus(e.target.value)}
                  placeholder="一句话描述项目目前推进到哪里"
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium">待跟进事项（每行一条）</div>
                <Textarea
                  rows={3}
                  value={carryForward}
                  onChange={(e) => setCarryForward(e.target.value)}
                  placeholder="例：feat(origin): 主聊压缩接 captain LLM"
                />
              </div>
              {preview.pinned_candidates.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium">候选钉住片段（点击选中）</div>
                  <div className="space-y-1.5">
                    {preview.pinned_candidates.map((c: PinnedQuoteCandidate) => {
                      const on = pickedPins.has(c.message_id);
                      return (
                        <button
                          key={c.message_id}
                          type="button"
                          onClick={() => togglePin(c.message_id)}
                          className={cn(
                            "block w-full rounded-md border px-3 py-2 text-left text-xs",
                            on
                              ? "border-primary bg-primary/5"
                              : "border-muted bg-muted/30 hover:border-muted-foreground/50",
                          )}
                        >
                          <div className="mb-0.5 font-medium">
                            {c.speaker} · {new Date(c.created_at).toLocaleString("zh-CN")}
                          </div>
                          <div className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                            {c.content}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                确认后旧主聊会归档（可在右栏「会话归档」Tab 回看），新主聊以摘要开场。
                完整 chat_message 不删，旧记录全保留。
              </p>
            </div>
          )}
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={confirm} disabled={confirmMut.isPending || !preview}>
              确认压缩
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConveneCouncilButton({
  projectId,
  chatSessionId,
  memberAgents,
  captain,
}: {
  projectId: string;
  chatSessionId: string;
  memberAgents: Agent[];
  captain: Agent | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const create = useCreateCouncilSession();

  const candidates = useMemo(() => {
    const list: Agent[] = [];
    if (captain) list.push(captain);
    for (const a of memberAgents) list.push(a);
    return list;
  }, [captain, memberAgents]);

  const submit = async () => {
    const trimmed = topic.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({
        topic: trimmed,
        activity_level: "concise",
        project_id: projectId,
        source_chat_session_id: chatSessionId,
        participant_agent_ids: Array.from(picked),
      });
      toast.success("会议室已开 — 散会后结论会自动写入项目记忆「关键决策」段");
      setOpen(false);
      setTopic("");
      setPicked(new Set());
    } catch (err) {
      toast.error("召开失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Users className="size-3" />
        召开 Council
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>召开 Council Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="议题：要让多个角色对齐什么？"
            rows={2}
          />
          <div className="text-xs text-muted-foreground">参会角色（默认全选 captain + 成员）：</div>
          <div className="flex flex-wrap gap-1.5">
            {candidates.length === 0 ? (
              <span className="text-xs text-muted-foreground">还没有可邀请的 Agent</span>
            ) : (
              candidates.map((a) => {
                const on = picked.has(a.id);
                return (
                  <Button
                    key={a.id}
                    size="sm"
                    variant={on ? "default" : "outline"}
                    onClick={() =>
                      setPicked((curr) => {
                        const next = new Set(curr);
                        if (next.has(a.id)) next.delete(a.id);
                        else next.add(a.id);
                        return next;
                      })
                    }
                  >
                    {a.name}
                  </Button>
                );
              })
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            散会时会议结论会自动追加到项目记忆文档「关键决策」段（PRD §17.6），
            同时回写到本项目主聊。
          </p>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={!topic.trim() || create.isPending}>
            召开
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DocTabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Bot;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs",
        active
          ? "bg-muted text-foreground font-medium"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}
