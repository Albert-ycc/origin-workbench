"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import {
  teamListOptions,
  useArchiveTeam,
  useDeleteTeam,
  useRestoreTeam,
} from "@multica/core/teams";
import type { Agent, Team } from "@multica/core/types";
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
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { cn } from "@multica/ui/lib/utils";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";
import { PageHeader } from "../layout/page-header";
import { ActorAvatar } from "../common/actor-avatar";
import { AppLink, useNavigation } from "../navigation";
import { EditTeamDialog } from "./edit-team-dialog";

export function TeamsPage() {
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();
  const wsPaths = useWorkspacePaths();
  const [view, setView] = useState<"active" | "archived">("active");
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: teams = [] } = useQuery(teamListOptions(wsId, view));

  // Server already returns teams ordered by updated_at desc; keep stable.
  const sorted = teams;

  const agentById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Team | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="gap-1.5">
        <WorkspaceAvatar name={workspace?.name ?? "W"} size="sm" />
        <span className="text-sm text-muted-foreground">
          {workspace?.name ?? "工作区"}
        </span>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="text-sm font-medium">团队</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 p-5">
          <section className="rounded-xl border bg-card p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Users className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold">团队</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  把若干智能体编成一个小队，由负责人协调群聊式协作。
                  从「智能体」页面任意 agent 卡片上点
                  <span className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    创建团队
                  </span>
                  组建。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                render={<AppLink href={wsPaths.agents()} />}
              >
                <Sparkles className="size-3.5" />
                去智能体页面
              </Button>
            </div>
          </section>

          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border bg-background p-1">
              {[
                ["active", "使用中"],
                ["archived", "已归档"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setView(value as "active" | "archived")}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    view === value
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === "archived" && (
              <span className="text-xs text-muted-foreground">
                已归档团队会保留历史，但不会出现在默认列表。
              </span>
            )}
          </div>

          {sorted.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sorted.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  agentById={agentById}
                  hrefDetail={`${wsPaths.teams()}/${team.id}`}
                  onEdit={() => setEditingTeam(team)}
                  onDelete={() => setConfirmDelete(team)}
                  isArchived={view === "archived"}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {editingTeam && (
        <EditTeamDialog
          team={editingTeam}
          onClose={() => setEditingTeam(null)}
        />
      )}

      {confirmDelete && (
        <DeleteTeamConfirm
          team={confirmDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function TeamCard({
  team,
  agentById,
  hrefDetail,
  onEdit,
  onDelete,
  isArchived,
}: {
  team: Team;
  agentById: Map<string, Agent>;
  hrefDetail: string;
  onEdit: () => void;
  onDelete: () => void;
  isArchived: boolean;
}) {
  const navigation = useNavigation();
  const archiveTeam = useArchiveTeam();
  const restoreTeam = useRestoreTeam();
  const captain = agentById.get(team.captain_agent_id);
  const memberAgents = team.members
    .filter((m) => m.role !== "captain")
    .map((m) => agentById.get(m.agent_id))
    .filter((a): a is NonNullable<typeof a> => !!a);
  const visible = memberAgents.slice(0, 4);
  const hidden = memberAgents.length - visible.length;

  // Card body is clickable to open detail; the menu trigger sits in a
  // pointer-events-isolated corner so its click doesn't bubble into the
  // card. We use a button-as-card (role=button) instead of <AppLink>
  // wrapper so the menu can live inside without nesting buttons.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigation.push(hrefDetail)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigation.push(hrefDetail);
        }
      }}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-all",
        "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div
        className="absolute right-2 top-2 z-10"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="团队操作"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
              />
            }
          >
            <MoreHorizontal className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5" />
              编辑
            </DropdownMenuItem>
            {isArchived ? (
              <DropdownMenuItem
                onClick={() =>
                  restoreTeam.mutate(team.id, {
                    onSuccess: () => toast.success("团队已恢复"),
                    onError: (err) =>
                      toast.error(err instanceof Error ? err.message : "恢复失败"),
                  })
                }
              >
                <RotateCcw className="size-3.5" />
                恢复团队
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() =>
                  archiveTeam.mutate(team.id, {
                    onSuccess: () => toast.success("团队已归档"),
                    onError: (err) =>
                      toast.error(err instanceof Error ? err.message : "归档失败"),
                  })
                }
              >
                <Archive className="size-3.5" />
                归档团队
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-3.5" />
              解散团队
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-3">
        {captain ? (
          <ActorAvatar
            actorType="agent"
            actorId={captain.id}
            size={40}
            className="rounded-full ring-2 ring-primary/30"
          />
        ) : (
          <div className="size-10 rounded-full bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate pr-8 text-sm font-semibold">
            {team.name}
          </div>
          <div className="line-clamp-1 text-xs text-muted-foreground">
            负责人：{captain?.name ?? "未知"}
          </div>
        </div>
      </div>
      <p className="line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">
        {team.description || "暂无团队职责描述"}
      </p>
      <div className="flex items-center justify-between border-t pt-3">
        <div className="flex items-center -space-x-2">
          {visible.map((agent) => (
            <ActorAvatar
              key={agent.id}
              actorType="agent"
              actorId={agent.id}
              size={24}
              className="rounded-full ring-2 ring-card"
            />
          ))}
          {hidden > 0 && (
            <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground ring-2 ring-card">
              +{hidden}
            </span>
          )}
          {memberAgents.length === 0 && (
            <span className="text-xs text-muted-foreground">
              暂无成员
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {team.members.length} 名成员
        </span>
      </div>
    </div>
  );
}

function DeleteTeamConfirm({
  team,
  onClose,
}: {
  team: Team;
  onClose: () => void;
}) {
  const deleteTeam = useDeleteTeam();
  const handle = () => {
    deleteTeam.mutate(team.id, {
      onSuccess: () => {
        toast.success(`「${team.name}」已解散`);
        onClose();
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "解散团队失败");
      },
    });
  };
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>解散团队</AlertDialogTitle>
          <AlertDialogDescription>
            「{team.name}」会被永久删除，群聊记录也一并清空。此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={handle}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            解散
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-background ring-1 ring-border">
        <Users className="size-5 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-sm font-semibold">还没有团队</h2>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        到「智能体」页面，从任意 agent 卡片底部点击「创建团队」，
        让它作为负责人组建一个小队。
      </p>
    </div>
  );
}
