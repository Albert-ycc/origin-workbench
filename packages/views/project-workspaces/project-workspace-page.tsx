"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, FileText, FolderOpen, Network, Sparkles } from "lucide-react";
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
} from "@multica/core/projects-v12";
import { teamDetailOptions } from "@multica/core/teams";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { Agent } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
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

type DocTab = "files" | "memory" | "items";

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
          <Button size="sm" variant="outline" disabled>
            <Sparkles className="size-3" />
            整理 + 重新出发
          </Button>
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
        </aside>
      </div>
    </div>
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
