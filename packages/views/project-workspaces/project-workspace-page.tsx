"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  ArchiveX,
  Bot,
  ChevronRight,
  Compass,
  FileText,
  FolderOpen,
  Lightbulb,
  Loader2,
  Mic,
  MoreHorizontal,
  Network,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Sparkles,
  Target,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspacePaths } from "@multica/core/paths";
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
  useStartProjectCompactionPreviewJob,
  useConfirmProjectCompaction,
  useArchiveProjectV12,
  useDeleteProjectV12,
  projectArchivedSessionsOptions,
  projectCompactionPreviewJobOptions,
} from "@multica/core/projects-v12";
import {
  missionListOptions,
  useCreateMission,
} from "@multica/core/missions";
import { ideaListOptions, useCreateIdea } from "@multica/core/ideas";
import {
  explorationListOptions,
  useCreateExploration,
} from "@multica/core/explorations";
import type {
  CompactionPreview,
  Exploration,
  Idea,
  Mission,
  MissionExecutionMode,
  MissionRiskLevel,
  PinnedQuoteCandidate,
  ProjectV12,
} from "@multica/core/types";
import { teamDetailOptions } from "@multica/core/teams";
import { useCreateCouncilSession } from "@multica/core/councils";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { Agent, Team } from "@multica/core/types";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { cn } from "@multica/ui/lib/utils";
import { PageHeader } from "../layout/page-header";
import { ChatPane } from "../teams/team-detail-page";
import { EditTeamDialog } from "../teams/edit-team-dialog";
import { useNavigation } from "../navigation";

// Project workspace page (PRD §17.3). Two-column layout:
//   left  — project main chat (one long timeline; reuses chat-window contract)
//   right — three tabs: 团队工作文件 / 项目记忆文档 / Mission&Idea&Exploration 列表
//
// This is the v1.2 stub: the chat column delegates to the existing chat
// surfaces (chat_session.project_id is the new linkage), and the doc column
// renders the memory_doc Markdown directly. Local file browser tab is
// scaffolded — the chokidar IPC bridge is Phase B+ work.

type DocTab = "files" | "memory" | "items" | "archive";

export const projectPrimaryActions = ["成员", "会议", "更多", "资料栏"] as const;

export const projectMoreMenuGroups = [
  { group: "协作类", items: ["多角色议事 / Council"] },
  { group: "维护类", items: ["整理 + 重新出发"] },
  { group: "危险类", items: ["归档", "删除"] },
] as const;

export const projectCouncilCopy = {
  dialogTitle: "发起多角色议事",
  success: "多角色议事已发起",
  participantLabel: "参与角色",
} as const;

export const projectCreateFlowTypes = [
  { type: "mission", label: "Mission" },
  { type: "idea", label: "Idea" },
  { type: "exploration", label: "Exploration" },
] as const;

export const projectResourcePanelDefault = {
  title: "项目记忆摘要",
  secondaryEntrypoints: ["文件", "项目入口", "会话归档"],
} as const;

export function ProjectWorkspacePage({
  projectId,
  sidebarCollapsed = false,
  onExpandSidebar,
}: {
  projectId: string;
  // Optional sidebar-coordination props (only set when rendered inside
  // ProjectWorkspacesListPage). When sidebar is collapsed, we render an
  // expand button in the leftmost slot of the PageHeader.
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
}) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
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
  const [resourceOpen, setResourceOpen] = useState(false);
  const [resourceTab, setResourceTab] = useState<DocTab>("memory");
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  // Right-side doc panel — collapsible like the project sidebar. Persisted so
  // a 13" screen user who lives in chat doesn't have to close it every time.
  const [docCollapsed, setDocCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem("origin:project-doc-collapsed");
    if (saved != null) return saved === "1";
    return window.innerWidth < 1500;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "origin:project-doc-collapsed",
      docCollapsed ? "1" : "0",
    );
  }, [docCollapsed]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const collapseWhenNarrow = () => {
      if (window.innerWidth < 1500) {
        setDocCollapsed(true);
      }
    };
    collapseWhenNarrow();
    window.addEventListener("resize", collapseWhenNarrow);
    return () => window.removeEventListener("resize", collapseWhenNarrow);
  }, []);

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
        <Button variant="outline" size="sm" onClick={() => navigation.push(paths.projectWorkspaces())}>
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
  const openResource = (tab: DocTab) => {
    setResourceTab(tab);
    setResourceOpen(true);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <PageHeader className="gap-2 overflow-hidden px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {sidebarCollapsed && onExpandSidebar && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onExpandSidebar}
              className="size-7 shrink-0 p-0"
              title="展开项目列表"
            >
              <PanelLeft className="size-4" />
            </Button>
          )}
          <span className="hidden shrink-0 text-sm text-muted-foreground lg:inline">
            项目工作区 /
          </span>
          <span className="min-w-0 truncate text-sm font-medium">{project.title}</span>
          <Badge
            variant="secondary"
            className={cn("hidden shrink-0 sm:inline-flex", statusTone[project.status])}
          >
            {statusCopy[project.status] ?? project.status}
          </Badge>
          {project.local_dir && (
            <code className="hidden max-w-[240px] shrink truncate rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground xl:inline-block 2xl:max-w-[320px]">
              {project.local_dir}
            </code>
          )}
        </div>
        <div className="flex max-w-[62%] shrink items-center gap-1.5 overflow-x-auto whitespace-nowrap pr-1">
          {team && <ManageMembersButton team={team} />}
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigation.push(paths.projectMeetings(project.id))}
          >
            <Mic className="size-4" />
            会议
          </Button>
          <ProjectMoreMenu
            projectId={project.id}
            projectTitle={project.title}
            archived={project.status === "archived"}
            mainChatSessionId={mainChat?.chat_session_id ?? null}
            memberAgents={memberAgents}
            captain={captain}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDocCollapsed((v) => !v)}
            className="size-7 p-0"
            title={docCollapsed ? "展开文档面板" : "收起文档面板"}
          >
            {docCollapsed ? (
              <PanelRightOpen className="size-4" />
            ) : (
              <PanelRightClose className="size-4" />
            )}
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
              onSend={(content, options) => {
                const trimmed = content.trim();
                if (!trimmed) return;
                if (!currentUser) {
                  toast.error("请先登录");
                  return;
                }
                postMessage.mutate(
                  {
                    projectId,
                    content: trimmed,
                    skill_ids: options?.skillIds,
                  },
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

        {/* Right: doc column — collapsible. When collapsed, removed from the
            DOM so the chat column reclaims the full width; expand control
            lives in the PageHeader as PanelRightOpen. Width follows the
            available viewport instead of claiming a fixed 480px. */}
        {!docCollapsed && (
          <aside className="flex w-[320px] shrink-0 flex-col border-l 2xl:w-[360px]">
            <ProjectMemorySummaryPanel
              project={project}
              editingMemory={editingMemory}
              memoryDraft={memoryDraft}
              updatePending={updateProject.isPending}
              onStartEdit={startEdit}
              onChangeDraft={setMemoryDraft}
              onCancelEdit={() => setEditingMemory(false)}
              onSave={saveMemory}
              onOpenResource={openResource}
            />
          </aside>
        )}
      </div>

      <ProjectResourcesDialog
        open={resourceOpen}
        onOpenChange={setResourceOpen}
        activeTab={resourceTab}
        onTabChange={setResourceTab}
        projectId={projectId}
        project={project}
        team={team}
        captain={captain}
        memberAgents={memberAgents}
      />
    </div>
  );
}

function ProjectMemorySummaryPanel({
  project,
  editingMemory,
  memoryDraft,
  updatePending,
  onStartEdit,
  onChangeDraft,
  onCancelEdit,
  onSave,
  onOpenResource,
}: {
  project: ProjectV12;
  editingMemory: boolean;
  memoryDraft: string;
  updatePending: boolean;
  onStartEdit: () => void;
  onChangeDraft: (value: string) => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onOpenResource: (tab: DocTab) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{projectResourcePanelDefault.title}</h2>
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onStartEdit}>
          编辑
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!editingMemory ? (
          <>
            <div className="mb-3 text-[11px] text-muted-foreground">
              {project.memory_doc_updated_at
                ? `最近更新 · ${new Date(project.memory_doc_updated_at).toLocaleString("zh-CN")}`
                : "尚未更新"}
            </div>
            {project.memory_doc ? (
              <pre className="max-h-[45vh] overflow-hidden whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90">
                {project.memory_doc}
              </pre>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
                还没有写入项目记忆。Council 散会、Mission 完成、用户钉住片段会自动追加到这里。
                也可以点上方「编辑」手动写一段项目目标作为开篇。
              </div>
            )}
          </>
        ) : (
          <div className="flex min-h-[360px] flex-col gap-2">
            <textarea
              className="flex-1 w-full resize-none rounded-md border bg-background p-3 font-mono text-xs leading-relaxed"
              value={memoryDraft}
              onChange={(e) => onChangeDraft(e.target.value)}
              placeholder="# 项目记忆\n\n## 项目目标\n...\n\n## 当前状态\n..."
            />
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                取消
              </Button>
              <Button size="sm" onClick={onSave} disabled={updatePending}>
                保存
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <div className="grid gap-2">
          <ResourceShortcut icon={FolderOpen} label="文件" onClick={() => onOpenResource("files")} />
          <ResourceShortcut icon={Network} label="项目入口" onClick={() => onOpenResource("items")} />
          <ResourceShortcut icon={Archive} label="会话归档" onClick={() => onOpenResource("archive")} />
        </div>
      </div>
    </div>
  );
}

function ResourceShortcut({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Bot;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/40"
    >
      <span className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        {label}
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}

function ProjectResourcesDialog({
  open,
  onOpenChange,
  activeTab,
  onTabChange,
  projectId,
  project,
  team,
  captain,
  memberAgents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: DocTab;
  onTabChange: (tab: DocTab) => void;
  projectId: string;
  project: Pick<ProjectV12, "local_dir">;
  team: Team | undefined;
  captain: Agent | undefined;
  memberAgents: Agent[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>项目资料</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2 border-b pb-2">
          <DocTabBtn active={activeTab === "files"} onClick={() => onTabChange("files")} icon={FolderOpen}>
            文件
          </DocTabBtn>
          <DocTabBtn active={activeTab === "items"} onClick={() => onTabChange("items")} icon={Network}>
            项目入口
          </DocTabBtn>
          <DocTabBtn active={activeTab === "archive"} onClick={() => onTabChange("archive")} icon={Archive}>
            会话归档
          </DocTabBtn>
        </div>
        <div className="min-h-[420px] overflow-y-auto">
          {activeTab === "files" && <ProjectFilesPanel project={project} />}
          {activeTab === "items" && (
            <ProjectOriginItemsTab
              projectId={projectId}
              team={team}
              captain={captain}
              memberAgents={memberAgents}
            />
          )}
          {activeTab === "archive" && <ArchivedSessionsTab projectId={projectId} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectFilesPanel({ project }: { project: Pick<ProjectV12, "local_dir"> }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
      <FolderOpen className="size-8 opacity-40" />
      <p className="max-w-xs text-xs leading-relaxed">
        当前项目绑定的本地工作目录上下文是：
      </p>
      <code className="rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
        {project.local_dir || "（未设置）"}
      </code>
      <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground/80">
        该路径会传递给本地 runtime 作为工作目录上下文；这里不承诺额外的默认读写权限。
      </p>
    </div>
  );
}

function ProjectOriginItemsTab({
  projectId,
  team,
  captain,
  memberAgents,
}: {
  projectId: string;
  team: Team | undefined;
  captain: Agent | undefined;
  memberAgents: Agent[];
}) {
  const wsId = useWorkspaceId();
  const { data: missions = [], isLoading: missionsLoading, error: missionsError } = useQuery(
    missionListOptions(wsId, "active", projectId),
  );
  const { data: ideas = [], isLoading: ideasLoading, error: ideasError } = useQuery(
    ideaListOptions(wsId, "active", projectId),
  );
  const {
    data: explorations = [],
    isLoading: explorationsLoading,
    error: explorationsError,
  } = useQuery(explorationListOptions(wsId, "active", projectId));

  const createMission = useCreateMission();
  const createIdea = useCreateIdea();
  const createExploration = useCreateExploration();
  const [createOpen, setCreateOpen] = useState(false);

  const visibleMissions = useMemo(
    () => keepProjectItems(missions, projectId),
    [missions, projectId],
  );
  const visibleIdeas = useMemo(
    () => keepProjectItems(ideas, projectId),
    [ideas, projectId],
  );
  const visibleExplorations = useMemo(
    () => keepProjectItems(explorations, projectId),
    [explorations, projectId],
  );

  const loading = missionsLoading || ideasLoading || explorationsLoading;
  const error = missionsError ?? ideasError ?? explorationsError;
  const hasItems =
    visibleMissions.length > 0 ||
    visibleIdeas.length > 0 ||
    visibleExplorations.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">项目入口</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              只展示当前项目下仍活跃的 Mission、Idea 和 Exploration。
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {visibleMissions.length + visibleIdeas.length + visibleExplorations.length}
          </Badge>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" />
          新建
        </Button>

        {error ? (
          <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">项目入口加载失败</div>
              <div className="mt-1 text-destructive/80">
                {error instanceof Error ? error.message : String(error)}
              </div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-2 pt-1">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !hasItems && !error ? (
          <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs leading-relaxed text-muted-foreground">
            当前项目还没有活跃入口。可以从上方快速创建，后续会按项目维度留在这里。
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <ProjectItemSection
              icon={Target}
              title="Missions"
              items={visibleMissions}
              getKey={(mission) => mission.id}
              renderItem={(mission) => (
                <ProjectItemRow
                  title={mission.title}
                  meta={`${missionStatusLabel(mission.status)} · ${formatProjectItemTime(mission.updated_at)}`}
                  body={mission.summary || mission.prompt}
                />
              )}
            />
            <ProjectItemSection
              icon={Lightbulb}
              title="Ideas"
              items={visibleIdeas}
              getKey={(idea) => idea.id}
              renderItem={(idea) => (
                <ProjectItemRow
                  title={idea.title}
                  meta={`${ideaStatusLabel(idea.status)} · ${formatProjectItemTime(idea.updated_at)}`}
                  body={idea.description}
                />
              )}
            />
            <ProjectItemSection
              icon={Compass}
              title="Explorations"
              items={visibleExplorations}
              getKey={(exploration) => exploration.id}
              renderItem={(exploration) => (
                <ProjectItemRow
                  title={exploration.topic}
                  meta={`${explorationStatusLabel(exploration.status)} · ${formatProjectItemTime(exploration.updated_at)}`}
                  body={exploration.question || exploration.decision}
                />
              )}
            />
          </div>
        )}
      </div>
      <ProjectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        team={team}
        captain={captain}
        memberAgents={memberAgents}
        createMission={createMission}
        createIdea={createIdea}
        createExploration={createExploration}
      />
    </div>
  );
}

function ProjectCreateDialog({
  open,
  onOpenChange,
  projectId,
  team,
  captain,
  memberAgents,
  createMission,
  createIdea,
  createExploration,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  team: Team | undefined;
  captain: Agent | undefined;
  memberAgents: Agent[];
  createMission: ReturnType<typeof useCreateMission>;
  createIdea: ReturnType<typeof useCreateIdea>;
  createExploration: ReturnType<typeof useCreateExploration>;
}) {
  const [type, setType] = useState<(typeof projectCreateFlowTypes)[number]["type"]>("mission");
  const [draft, setDraft] = useState("");
  const [riskLevel, setRiskLevel] = useState<MissionRiskLevel>("low");
  const [executionMode, setExecutionMode] = useState<MissionExecutionMode>("auto");
  const [memberIds, setMemberIds] = useState<string[]>(() => memberAgents.map((agent) => agent.id));

  useEffect(() => {
    if (!open) return;
    setMemberIds(memberAgents.map((agent) => agent.id));
  }, [open, memberAgents]);

  const reset = () => {
    setType("mission");
    setDraft("");
    setRiskLevel("low");
    setExecutionMode("auto");
    setMemberIds(memberAgents.map((agent) => agent.id));
  };
  const close = () => {
    reset();
    onOpenChange(false);
  };
  const pending = createMission.isPending || createIdea.isPending || createExploration.isPending;

  const submit = async () => {
    const value = draft.trim();
    if (!value) return;
    try {
      if (type === "mission") {
        if (!captain) {
          toast.error("当前项目还没有负责人，无法创建 Mission");
          return;
        }
        await createMission.mutateAsync({
          project_id: projectId,
          team_id: team?.id,
          captain_agent_id: captain.id,
          member_agent_ids: memberIds,
          title: titleFromProjectDraft(value, "未命名 Mission"),
          prompt: value,
          risk_level: riskLevel,
          execution_mode: executionMode,
        });
        toast.success("Mission 已创建");
      } else if (type === "idea") {
        await createIdea.mutateAsync({
          project_id: projectId,
          description: value,
          source: "manual",
        });
        toast.success("Idea 已记录");
      } else {
        await createExploration.mutateAsync({
          project_id: projectId,
          topic: titleFromProjectDraft(value, "未命名探索"),
          question: value,
        });
        toast.success("Exploration 已创建");
      }
      close();
    } catch (err) {
      const label = projectCreateFlowTypes.find((item) => item.type === type)?.label ?? "项目入口";
      toast.error(`${label} 创建失败`, {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
        else onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建项目入口</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {projectCreateFlowTypes.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => setType(item.type)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm transition-colors",
                  type === item.type
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div>
            <div className="mb-1 text-xs font-medium">
              {type === "mission" ? "目标" : type === "idea" ? "想法" : "探索问题"}
            </div>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={4}
              className="min-h-28 resize-none"
              placeholder={
                type === "mission"
                  ? "要让项目团队执行什么？"
                  : type === "idea"
                    ? "先收进项目想法池..."
                    : "要探索或比较什么方案？"
              }
            />
          </div>

          {type === "mission" && (
            <div className="space-y-4 rounded-md border bg-muted/20 p-3">
              <div className="grid gap-3 text-xs md:grid-cols-2">
                <div>
                  <div className="font-medium">负责人</div>
                  <div className="mt-1 text-muted-foreground">{captain?.name ?? "当前项目未设置负责人"}</div>
                </div>
                <div>
                  <div className="font-medium">协作成员</div>
                  <div className="mt-1 text-muted-foreground">{memberIds.length} 位</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {memberAgents.map((agent) => {
                  const on = memberIds.includes(agent.id);
                  return (
                    <Button
                      key={agent.id}
                      size="sm"
                      variant={on ? "default" : "outline"}
                      onClick={() =>
                        setMemberIds((curr) =>
                          curr.includes(agent.id)
                            ? curr.filter((id) => id !== agent.id)
                            : [...curr, agent.id],
                        )
                      }
                    >
                      {agent.name}
                    </Button>
                  );
                })}
              </div>
              <OptionButtons
                label="风险级别"
                value={riskLevel}
                options={[
                  ["low", "低风险"],
                  ["medium", "中风险"],
                  ["high", "高风险"],
                ]}
                onChange={(value) => setRiskLevel(value as MissionRiskLevel)}
              />
              <OptionButtons
                label="执行模式"
                value={executionMode}
                options={[
                  ["auto", "自动执行"],
                  ["confirm", "关键确认"],
                  ["step_confirm", "逐步确认"],
                ]}
                onChange={(value) => setExecutionMode(value as MissionExecutionMode)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={pending || !draft.trim() || (type === "mission" && !captain)}>
            {pending ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptionButtons({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([optionValue, optionLabel]) => (
          <Button
            key={optionValue}
            size="sm"
            variant={value === optionValue ? "default" : "outline"}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ProjectItemSection<T>({
  icon: Icon,
  title,
  items,
  getKey,
  renderItem,
}: {
  icon: typeof Bot;
  title: string;
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
        <span className="text-[10px]">({items.length})</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={getKey(item)}>{renderItem(item)}</div>
        ))}
      </div>
    </section>
  );
}

function ProjectItemRow({
  title,
  meta,
  body,
}: {
  title: string;
  meta: string;
  body?: string;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-medium">{title || "未命名"}</div>
        <div className="shrink-0 text-[10px] text-muted-foreground">{meta}</div>
      </div>
      {body ? (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {body}
        </p>
      ) : null}
    </div>
  );
}

export function keepProjectItems<T extends { project_id?: string | null }>(
  items: T[],
  projectId: string,
) {
  return items.filter((item) => item.project_id === projectId);
}

function titleFromProjectDraft(value: string, fallback: string) {
  const first = value.trim().replace(/\s+/g, " ").split(/[。.!?\n]/)[0] ?? "";
  if (!first) return fallback;
  return first.length > 42 ? `${first.slice(0, 42)}...` : first;
}

function formatProjectItemTime(raw: string) {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function missionStatusLabel(status: Mission["status"]) {
  return {
    draft: "草稿",
    planning: "规划中",
    waiting_confirmation: "待确认",
    executing: "执行中",
    blocked: "受阻",
    completed: "已完成",
    archived: "已归档",
  }[status] ?? status;
}

function ideaStatusLabel(status: Idea["status"]) {
  return {
    draft: "草稿",
    nurturing: "养育中",
    promoted: "已升级",
    archived: "已归档",
  }[status] ?? status;
}

function explorationStatusLabel(status: Exploration["status"]) {
  return {
    open: "开放",
    converging: "收敛中",
    closed: "已关闭",
    archived: "已归档",
  }[status] ?? status;
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

function ProjectMoreMenu({
  projectId,
  projectTitle,
  archived,
  mainChatSessionId,
  memberAgents,
  captain,
}: {
  projectId: string;
  projectTitle: string;
  archived: boolean;
  mainChatSessionId: string | null;
  memberAgents: Agent[];
  captain: Agent | undefined;
}) {
  const [councilOpen, setCouncilOpen] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
          <MoreHorizontal className="size-4" />
          更多
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>协作类</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={!mainChatSessionId}
              onClick={() => setCouncilOpen(true)}
            >
              <Users className="size-3.5" />
              多角色议事 / Council
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>维护类</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setCompactOpen(true)}>
              <Sparkles className="size-3.5" />
              整理 + 重新出发
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>危险类</DropdownMenuLabel>
            {!archived && (
              <DropdownMenuItem onClick={() => setArchiveOpen(true)}>
                <ArchiveX className="size-3.5" />
                归档
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" />
              删除
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {mainChatSessionId && (
        <ConveneCouncilDialog
          open={councilOpen}
          onOpenChange={setCouncilOpen}
          projectId={projectId}
          chatSessionId={mainChatSessionId}
          memberAgents={memberAgents}
          captain={captain}
        />
      )}
      <CompactionDialog
        open={compactOpen}
        onOpenChange={setCompactOpen}
        projectId={projectId}
      />
      <ArchiveProjectDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        projectId={projectId}
        projectTitle={projectTitle}
      />
      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectId={projectId}
        projectTitle={projectTitle}
      />
    </>
  );
}

function CompactionDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const wsId = useWorkspaceId();
  const [preview, setPreview] = useState<CompactionPreview | null>(null);
  const [keyDecisions, setKeyDecisions] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [currentStatus, setCurrentStatus] = useState("");
  const [carryForward, setCarryForward] = useState("");
  const [pickedPins, setPickedPins] = useState<Set<string>>(new Set());
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [hydratedJobId, setHydratedJobId] = useState<string | null>(null);
  const previewMut = usePreviewProjectCompaction();
  const startJobMut = useStartProjectCompactionPreviewJob();
  const confirmMut = useConfirmProjectCompaction(wsId);
  const previewJobQuery = useQuery({
    ...projectCompactionPreviewJobOptions(wsId, projectId, previewJobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" || status === "cancelled"
        ? false
        : 2000;
    },
  });

  const hydratePreview = (data: CompactionPreview) => {
    setPreview(data);
    setKeyDecisions((data.key_decisions ?? []).join("\n"));
    setDeliverables((data.deliverables ?? []).join("\n"));
    setCurrentStatus(data.current_status ?? "");
    setCarryForward((data.carry_forward ?? []).join("\n"));
    setPickedPins(new Set((data.pinned_candidates ?? []).map((p) => p.message_id)));
  };

  useEffect(() => {
    const job = previewJobQuery.data;
    if (!job || !previewJobId || hydratedJobId === previewJobId) return;
    if (job.status === "completed" && job.preview) {
      hydratePreview(job.preview);
      setHydratedJobId(previewJobId);
      if (job.error) {
        toast.warning("Captain 输出未通过校验，已使用规则预览", {
          description: job.error,
        });
      }
      return;
    }
    if (job.status === "failed" || job.status === "cancelled") {
      hydratePreview(job.fallback_preview);
      setHydratedJobId(previewJobId);
      toast.error("Captain 智能压缩未完成，已切到规则预览", {
        description: job.error,
      });
    }
  }, [previewJobQuery.data, previewJobId, hydratedJobId]);

  const start = async () => {
    setPreview(null);
    setPreviewJobId(null);
    setHydratedJobId(null);
    try {
      const job = await startJobMut.mutateAsync(projectId);
      setPreviewJobId(job.task_id);
    } catch (err) {
      try {
        const data = await previewMut.mutateAsync(projectId);
        hydratePreview(data);
        toast.warning("Captain 智能压缩不可用，已使用规则预览", {
          description: err instanceof Error ? err.message : String(err),
        });
      } catch (fallbackErr) {
        onOpenChange(false);
        toast.error("无法预览压缩", {
          description: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        });
      }
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
      onOpenChange(false);
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

  useEffect(() => {
    if (!open) return;
    void start();
    // Start a fresh preview each time the menu action opens the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>整理项目主聊（压缩预览）</DialogTitle>
          </DialogHeader>
          {!preview ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full" />
              <div className="text-xs text-muted-foreground">
                Captain 正在梳理主聊上下文，完成后会自动生成可编辑预览。
                {previewJobQuery.data?.fallback_preview && (
                  <>
                    {" "}当前规则兜底范围：{previewJobQuery.data.fallback_preview.message_count} 条消息。
                  </>
                )}
              </div>
            </div>
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
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={confirm} disabled={confirmMut.isPending || !preview}>
              确认压缩
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}

function ConveneCouncilDialog({
  open,
  onOpenChange,
  projectId,
  chatSessionId,
  memberAgents,
  captain,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  chatSessionId: string;
  memberAgents: Agent[];
  captain: Agent | undefined;
}) {
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
      toast.success(`${projectCouncilCopy.success} — 结束后结论会自动写入项目记忆「关键决策」段`);
      onOpenChange(false);
      setTopic("");
      setPicked(new Set());
    } catch (err) {
      toast.error("召开失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{projectCouncilCopy.dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="议题：要让多个角色对齐什么？"
            rows={2}
          />
          <div className="text-xs text-muted-foreground">
            {projectCouncilCopy.participantLabel}（默认全选 captain + 成员）：
          </div>
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
            结束时议事结论会自动追加到项目记忆文档「关键决策」段（PRD §17.6），
            同时回写到本项目主聊。
          </p>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={!topic.trim() || create.isPending}>
            召开
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
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
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs",
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

function ManageMembersButton({ team }: { team: Team }) {
  const [open, setOpen] = useState(false);
  // captain + 非 captain 成员，去重计数。
  const memberCount = team.members.length;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        title="管理项目成员"
      >
        <UserPlus className="size-3" />
        成员 · {memberCount}
      </Button>
      {open && <EditTeamDialog team={team} onClose={() => setOpen(false)} />}
    </>
  );
}

function ArchiveProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectTitle: string;
}) {
  const wsId = useWorkspaceId();
  const archive = useArchiveProjectV12(wsId);

  const submit = async () => {
    try {
      await archive.mutateAsync(projectId);
      toast.success(`「${projectTitle}」已归档`);
      onOpenChange(false);
    } catch (err) {
      toast.error("归档失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>归档「{projectTitle}」？</AlertDialogTitle>
          <AlertDialogDescription>
            归档后项目从工作区列表里隐藏，主聊和记忆文档保留可查。本地目录不会被删。需要重新启用时联系下棒手工 unarchive。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={archive.isPending}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={submit} disabled={archive.isPending}>
            {archive.isPending ? "归档中…" : "确认归档"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectTitle: string;
}) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const remove = useDeleteProjectV12(wsId);

  const submit = async () => {
    try {
      await remove.mutateAsync(projectId);
      toast.success(`「${projectTitle}」已删除`);
      onOpenChange(false);
      navigation.push(paths.projectWorkspaces());
    } catch (err) {
      toast.error("删除失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除「{projectTitle}」？</AlertDialogTitle>
          <AlertDialogDescription>
            此操作无法撤销。项目主聊、会议、Mission、Idea、分岔探索、工具绑定和项目记忆会一并删除。本地目录不会被删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={submit}
            disabled={remove.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {remove.isPending ? "删除中…" : "确认删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
