"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Plus, Sparkles } from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { projectV12ListOptions, useCreateProjectV12 } from "@multica/core/projects-v12";
import { teamListOptions } from "@multica/core/teams";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
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
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { toast } from "sonner";
import { AppLink } from "../navigation";
import { PageHeader } from "../layout/page-header";

export function ProjectWorkspacesListPage() {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { data: projects = [], isLoading } = useQuery(projectV12ListOptions(wsId));
  const { data: teams = [] } = useQuery(teamListOptions(wsId));
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-1 flex-col bg-background">
      <PageHeader className="gap-1.5">
        <span className="text-sm text-muted-foreground">Origin / </span>
        <span className="text-sm font-medium">项目工作区</span>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreating(true)} disabled={teams.length === 0}>
            <Plus className="size-3.5" />
            新建项目
          </Button>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">项目工作区</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              每个项目绑定一个本地工作目录，团队 Agent 在项目内的对话、产出、记忆都收敛到这里——并行多项目互不污染。
            </p>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-2xl" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-muted/20 p-12 text-center">
              <FolderOpen className="mx-auto mb-3 size-10 text-muted-foreground opacity-50" />
              <p className="text-sm font-medium text-foreground mb-1">还没有项目</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed mb-4">
                项目把团队的工作收敛到一个本地目录——所有 Mission、Idea、Council、产出都归在项目下。
                {teams.length === 0 && "需要先创建一个团队。"}
              </p>
              {teams.length > 0 ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-4" />
                  新建第一个项目
                </Button>
              ) : (
                <AppLink href={paths.teams()}>
                  <Button variant="outline">先去创建团队</Button>
                </AppLink>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <AppLink
                  key={project.id}
                  href={paths.projectWorkspaceDetail(project.id)}
                  className="group rounded-2xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <FolderOpen className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{project.title}</h3>
                        <Badge variant="secondary" className={cn("h-5 text-[10px]", projectStatusTone[project.status])}>
                          {projectStatusCopy[project.status] ?? project.status}
                        </Badge>
                      </div>
                      {project.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                          {project.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {project.local_dir && (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <FolderOpen className="size-3" />
                        <code className="truncate font-mono">{project.local_dir}</code>
                      </div>
                    )}
                    {project.compaction_count > 0 && (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Sparkles className="size-3" />
                        第 {project.compaction_count} 次压缩
                      </div>
                    )}
                  </div>
                </AppLink>
              ))}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <CreateProjectDialog
          teams={teams}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

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

function CreateProjectDialog({
  teams,
  onClose,
}: {
  teams: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const create = useCreateProjectV12(wsId);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [localDir, setLocalDir] = useState("");

  const submit = async () => {
    if (!title.trim()) {
      toast.error("先给项目起个名字");
      return;
    }
    if (!localDir.trim()) {
      toast.error("绑定一个本地目录");
      return;
    }
    try {
      const project = await create.mutateAsync({
        team_id: teamId || undefined,
        title: title.trim(),
        description: description.trim(),
        local_dir: localDir.trim(),
      });
      toast.success(`「${project.title}」已创建`);
      onClose();
      window.location.assign(paths.projectWorkspaceDetail(project.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            项目把团队的工作收敛到一个本地工作目录。绑定后所有 Mission、Idea、Council、产出都归在项目下。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="proj-team" className="text-xs">归属团队</Label>
            <select
              id="proj-team"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
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
            <Input
              id="proj-dir"
              value={localDir}
              onChange={(e) => setLocalDir(e.target.value)}
              placeholder="~/<redacted>/营养管理"
              className="font-mono text-[12px]"
            />
            <p className="text-[11px] text-muted-foreground">绑定后不可改。所有团队 Agent 默认获得读权限。</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>取消</Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "创建中…" : "创建项目"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
