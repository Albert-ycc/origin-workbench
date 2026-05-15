"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, PanelLeftClose, Plus } from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  projectV12ListOptions,
  useCreateProjectV12,
} from "@multica/core/projects-v12";
import { agentListOptions } from "@multica/core/workspace/queries";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { toast } from "sonner";
import { ActorAvatar } from "../common/actor-avatar";
import { useNavigation } from "../navigation";
import { ProjectWorkspacePage } from "./project-workspace-page";

// /workspaces 二栏布局: 左 sidebar list + 右主区 detail
// /workspaces/:id 走同一个组件，:id 决定主区显示哪个项目
export function ProjectWorkspacesListPage({ projectId }: { projectId?: string }) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const { data: projects = [], isLoading } = useQuery(
    projectV12ListOptions(wsId),
  );
  const [creating, setCreating] = useState(false);

  const activeId = projectId ?? projects[0]?.id ?? "";

  // Sidebar collapse — persisted so the user's preference survives reloads.
  // The chat column is the protagonist of this page; the project picker is
  // navigation overhead and should be hideable on smaller windows.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem("origin:project-sidebar-collapsed");
    if (saved != null) return saved === "1";
    return window.innerWidth < 1360;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "origin:project-sidebar-collapsed",
      sidebarCollapsed ? "1" : "0",
    );
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const collapseWhenNarrow = () => {
      if (window.innerWidth < 1360) {
        setSidebarCollapsed(true);
      }
    };
    collapseWhenNarrow();
    window.addEventListener("resize", collapseWhenNarrow);
    return () => window.removeEventListener("resize", collapseWhenNarrow);
  }, []);

  return (
    <div className="flex flex-1 min-h-0 bg-background">
      {/* 左侧项目列表 — collapsible via the in-header chevron button. When
          collapsed, the aside is removed from the DOM entirely so the chat
          column reclaims the full width without leaving a dead strip. The
          ProjectWorkspacePage shows an expand button in its PageHeader. */}
      {!sidebarCollapsed && (
        <aside className="flex w-[220px] shrink-0 flex-col border-r 2xl:w-[240px]">
          <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSidebarCollapsed(true)}
              className="size-7 shrink-0 p-0"
              title="收起项目列表"
            >
              <PanelLeftClose className="size-4" />
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">项目工作区</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCreating(true)}
              className="size-7 shrink-0 p-0"
              title="新建项目"
            >
              <Plus className="size-4" />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="space-y-2 p-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-md" />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="px-2 py-8 text-center">
                <FolderOpen className="mx-auto mb-2 size-6 text-muted-foreground opacity-50" />
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                  还没有项目
                </p>
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="size-3.5" />
                  新建项目
                </Button>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {projects.map((project) => {
                  const isActive = project.id === activeId;
                  return (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() =>
	                          navigation.push(paths.projectWorkspaceDetail(project.id))
                        }
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                          isActive ? "bg-muted" : "hover:bg-muted/60",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            projectStatusDot[project.status] ??
                              "bg-muted-foreground/40",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium leading-5">
                            {project.title}
                          </div>
                          {project.description && (
                            <div className="hidden truncate text-[11px] text-muted-foreground 2xl:block">
                              {project.description}
                            </div>
                          )}
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                            <Badge
                              variant="secondary"
                              className={cn(
                                "h-4 px-1.5 text-[10px]",
                                projectStatusTone[project.status] ??
                                  "bg-muted text-muted-foreground",
                              )}
                            >
                              {projectStatusCopy[project.status] ??
                                project.status}
                            </Badge>
                            {project.compaction_count > 0 && (
                              <span>压缩 ×{project.compaction_count}</span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      )}

      {/* 右侧主区 */}
      <main className="flex flex-1 min-w-0">
        {activeId ? (
          <ProjectWorkspacePage
            key={activeId}
            projectId={activeId}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={() => setSidebarCollapsed(false)}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
            <FolderOpen className="mb-3 size-12 text-muted-foreground opacity-40" />
            <p className="mb-1 text-base font-medium">从左侧选一个项目</p>
            <p className="max-w-md text-sm text-muted-foreground leading-relaxed">
              项目把团队的工作收敛到一个本地工作目录——所有 Mission、Idea、
              Council、产出都归在项目下。
            </p>
          </div>
        )}
      </main>

      {creating && (
        <CreateProjectDialog onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

type DirectoryPickerAPI = {
  desktopAPI?: {
    selectDirectory?: () => Promise<string | null>;
  };
};

const projectStatusDot: Record<string, string> = {
  active: "bg-emerald-500",
  paused: "bg-amber-500",
  completed: "bg-blue-500",
  archived: "bg-muted-foreground/40",
};
const projectStatusTone: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20",
  paused: "bg-amber-500/15 text-amber-500 border-amber-500/20",
  completed: "bg-blue-500/15 text-blue-500 border-blue-500/20",
  archived: "bg-muted text-muted-foreground",
};
const projectStatusCopy: Record<string, string> = {
  active: "推进中",
  paused: "暂停",
  completed: "已完成",
  archived: "归档",
};

function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const create = useCreateProjectV12(wsId);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const activeAgents = agents.filter((a) => !a.archived_at);
  const [agentIds, setAgentIds] = useState<Set<string>>(new Set());
  const [captainId, setCaptainId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [localDir, setLocalDir] = useState("");
  const canPickDirectory =
    typeof window !== "undefined" &&
    Boolean((window as unknown as DirectoryPickerAPI).desktopAPI?.selectDirectory);

  const toggleAgent = (id: string) => {
    setAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (captainId === id) setCaptainId("");
      } else {
        next.add(id);
        if (!captainId) setCaptainId(id);
      }
      return next;
    });
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.error("先给项目起个名字");
      return;
    }
    if (!localDir.trim()) {
      toast.error("绑定一个本地目录");
      return;
    }
    if (agentIds.size === 0) {
      toast.error("至少选一个 agent 加入项目");
      return;
    }
    if (!captainId) {
      toast.error("指定一个 agent 作为 captain");
      return;
    }
    try {
      const project = await create.mutateAsync({
        agent_ids: Array.from(agentIds),
        captain_agent_id: captainId,
        title: title.trim(),
        description: description.trim(),
        local_dir: localDir.trim(),
      });
      toast.success(`「${project.title}」已创建`);
      onClose();
      navigation.push(paths.projectWorkspaceDetail(project.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const pickDirectory = async () => {
    const picker = (window as unknown as DirectoryPickerAPI).desktopAPI?.selectDirectory;
    if (!picker) return;
    const dir = await picker();
    if (dir) setLocalDir(dir);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            从 agent 池里挑参与项目的成员，指定一个 captain。系统会自动找
            agent 集合相同 + captain 一致的协作组复用；找不到就为这个项目建一个新的。
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 space-y-4 overflow-y-auto py-2 pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="proj-title" className="text-xs">项目名</Label>
            <Input
              id="proj-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="营养库重构"
              maxLength={80}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proj-desc" className="text-xs">项目目标（可选）</Label>
            <Textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话说清这个项目要解决什么。"
              rows={2}
              maxLength={400}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proj-dir" className="text-xs">绑定本地工作目录</Label>
            <div className="flex gap-2">
              <Input
                id="proj-dir"
                value={localDir}
                onChange={(e) => setLocalDir(e.target.value)}
                placeholder="/path/to/project"
                className="font-mono text-[12px]"
              />
              {canPickDirectory && (
                <Button type="button" variant="outline" onClick={pickDirectory}>
                  <FolderOpen className="size-4" />
                  选择
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              绑定后不可改。该路径会传递给本地 runtime 作为工作目录上下文；实际读写权限取决于本机运行环境。
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">参与 agent</Label>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span>已选 {agentIds.size} / {activeAgents.length}</span>
                {agentIds.size > 0 && captainId && (
                  <span>
                    captain · {agents.find((a) => a.id === captainId)?.name ?? "?"}
                  </span>
                )}
              </div>
            </div>
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-1">
              {activeAgents.length === 0 ? (
                <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                  还没有可用的 agent。先到「智能体」创建一个再来。
                </div>
              ) : (
                activeAgents.map((agent) => {
                  const checked = agentIds.has(agent.id);
                  const isCaptain = checked && captainId === agent.id;
                  return (
                    <div
                      key={agent.id}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-2 py-2 transition-colors",
                        checked ? "bg-primary/10" : "hover:bg-muted",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleAgent(agent.id)}
                        className="flex flex-1 items-center gap-3 text-left"
                      >
                        <ActorAvatar
                          actorType="agent"
                          actorId={agent.id}
                          size={32}
                          className="rounded-full"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{agent.name}</div>
                          <div className="line-clamp-1 text-xs text-muted-foreground">
                            {agent.description || "暂无描述"}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full border text-[10px]",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/30 text-transparent",
                          )}
                        >
                          ✓
                        </span>
                      </button>
                      {checked && (
                        <button
                          type="button"
                          onClick={() => setCaptainId(agent.id)}
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                            isCaptain
                              ? "border-amber-500 bg-amber-500/15 text-amber-500"
                              : "border-muted-foreground/30 text-muted-foreground hover:border-amber-500 hover:text-amber-500",
                          )}
                          title="设为 captain"
                        >
                          {isCaptain ? "✓ captain" : "设 captain"}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              captain 是项目的协调者——你跟它单聊布置任务，它给被 @ 的成员派活。建议选产品经理 / 项目经理类的 agent。
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            取消
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "创建中…" : "创建项目"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
