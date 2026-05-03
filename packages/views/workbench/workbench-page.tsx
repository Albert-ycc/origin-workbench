"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  Clock3,
  Compass,
  Inbox,
  Layers3,
  Lightbulb,
  MessageSquare,
  Monitor,
  Network,
  Route,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import { missionListOptions } from "@multica/core/missions";
import { deriveRuntimeHealth } from "@multica/core/runtimes";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { Agent, AgentRuntime, Mission } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { PageHeader } from "../layout/page-header";
import { AppLink } from "../navigation";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";

type WorkbenchCardProps = {
  title: string;
  icon: typeof Bot;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

const statusCopy: Record<Mission["status"], string> = {
  draft: "草稿",
  planning: "规划中",
  waiting_confirmation: "待确认",
  executing: "执行中",
  blocked: "受阻",
  completed: "已完成",
  archived: "已归档",
};

const missionStatusTone: Record<Mission["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  planning: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  waiting_confirmation: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  executing: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  blocked: "bg-destructive/10 text-destructive",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  archived: "bg-muted text-muted-foreground",
};

const runtimeHealthCopy = {
  online: "在线",
  recently_lost: "刚断开",
  offline: "离线",
  about_to_gc: "即将清理",
} as const;

const runtimeHealthTone = {
  online: "bg-success",
  recently_lost: "bg-warning",
  offline: "bg-muted-foreground/40",
  about_to_gc: "bg-destructive",
} as const;

function isActiveAgent(agent: Agent) {
  return !agent.archived_at;
}

function activeMission(mission: Mission) {
  return mission.status !== "completed" && mission.status !== "archived";
}

function formatTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function WorkbenchPage() {
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();
  const p = useWorkspacePaths();
  const { data: agents = [], isLoading: agentsLoading } = useQuery(agentListOptions(wsId));
  const { data: missions = [], isLoading: missionsLoading } = useQuery(missionListOptions(wsId));
  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(runtimeListOptions(wsId));

  const activeAgents = useMemo(() => agents.filter(isActiveAgent), [agents]);
  const favoriteAgents = activeAgents.slice(0, 5);
  const openMissions = useMemo(() => missions.filter(activeMission), [missions]);
  const leaderMissionCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const mission of openMissions) {
      map.set(mission.captain_agent_id, (map.get(mission.captain_agent_id) ?? 0) + 1);
    }
    return map;
  }, [openMissions]);
  const runtimeSummary = useMemo(() => summarizeRuntimes(runtimes), [runtimes]);
  const pendingConfirmations = openMissions.filter((m) => m.status === "waiting_confirmation" || m.risk_level !== "low");
  const blockedMissions = openMissions.filter((m) => m.status === "blocked");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <PageHeader className="gap-1.5">
        <WorkspaceAvatar name={workspace?.name ?? "O"} size="sm" />
        <span className="text-sm text-muted-foreground">Origin / 原点工作台</span>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="text-sm font-medium">总览</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-7xl gap-4 p-5 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
          <section className="space-y-4">
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Compass className="size-4" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-semibold">原点工作台</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    从想法进入任务，让负责人组织智能体完成执行和沉淀。
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Metric label="智能体" value={activeAgents.length} loading={agentsLoading} />
                <Metric label="Mission" value={openMissions.length} loading={missionsLoading} />
                <Metric label="能力" value={runtimeSummary.online} loading={runtimesLoading} />
              </div>
            </div>

            <WorkbenchCard
              title="想法池"
              icon={Lightbulb}
              action={
                <Button variant="ghost" size="sm" render={<AppLink href={p.ideas()} />}>
                  打开
                </Button>
              }
            >
              <div className="space-y-3">
                <button
                  type="button"
                  className="w-full rounded-md border border-dashed bg-background p-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="size-4 text-primary" />
                    捕捉一个未成型想法
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Phase 3 会接入真实 Idea 对象和一键转 Mission。
                  </p>
                </button>
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-xs font-medium text-muted-foreground">待产品化队列</div>
                  <div className="mt-2 space-y-2 text-sm">
                    <IdeaLine text="长期 Agent 单聊入口" />
                    <IdeaLine text="Council Session 临时会议室" />
                    <IdeaLine text="分叉探索和方案对比" />
                  </div>
                </div>
              </div>
            </WorkbenchCard>

            <WorkbenchCard
              title="能力池"
              icon={Monitor}
              action={
                <Button variant="ghost" size="sm" render={<AppLink href={p.runtimes()} />}>
                  管理
                </Button>
              }
            >
              {runtimesLoading ? (
                <StackSkeleton rows={4} />
              ) : runtimes.length === 0 ? (
                <EmptyText text="还没有发现本地 CLI 或 API provider。" />
              ) : (
                <div className="space-y-2">
                  {runtimeSummary.items.slice(0, 5).map((item) => (
                    <div key={item.runtime.id} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
                      <span className={cn("size-2 rounded-full", runtimeHealthTone[item.health])} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{item.runtime.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {item.runtime.provider} · {runtimeHealthCopy[item.health]}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </WorkbenchCard>
          </section>

          <section className="space-y-4">
            <WorkbenchCard
              title="常驻智能体私聊"
              icon={Bot}
              action={
                <Button variant="outline" size="sm" render={<AppLink href={p.agents()} />}>
                  管理智能体
                </Button>
              }
            >
              {agentsLoading ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <AgentSkeleton />
                  <AgentSkeleton />
                  <AgentSkeleton />
                  <AgentSkeleton />
                </div>
              ) : favoriteAgents.length === 0 ? (
                <EmptyText text="先从能力池创建一个智能体，再建立长期私聊。" />
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {favoriteAgents.map((agent) => (
                    <AppLink
                      key={agent.id}
                      href={p.agentDetail(agent.id)}
                      className="group rounded-lg border bg-background p-3 transition-all hover:border-primary/30 hover:shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <ActorAvatar actorType="agent" actorId={agent.id} size={36} showStatusDot />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{agent.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {agent.model || agent.runtime_mode}
                          </div>
                        </div>
                        <MessageSquare className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>长期上下文</span>
                        <Badge variant="secondary" className="bg-muted text-muted-foreground">
                          {leaderMissionCount.get(agent.id) ?? 0} 个牵头 Mission
                        </Badge>
                      </div>
                    </AppLink>
                  ))}
                </div>
              )}
            </WorkbenchCard>

            <WorkbenchCard
              title="进行中 Mission"
              icon={Network}
              action={
                <Button variant="outline" size="sm" render={<AppLink href={p.missions()} />}>
                  进入任务中枢
                </Button>
              }
            >
              {missionsLoading ? (
                <StackSkeleton rows={5} />
              ) : openMissions.length === 0 ? (
                <EmptyText text="当前没有进行中的 Mission。" />
              ) : (
                <div className="divide-y rounded-lg border">
                  {openMissions.slice(0, 6).map((mission) => (
                    <AppLink
                      key={mission.id}
                      href={p.missions()}
                      className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Network className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{mission.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          更新于 {formatTime(mission.updated_at)}
                        </div>
                      </div>
                      <Badge variant="secondary" className={missionStatusTone[mission.status]}>
                        {statusCopy[mission.status]}
                      </Badge>
                    </AppLink>
                  ))}
                </div>
              )}
            </WorkbenchCard>
          </section>

          <section className="space-y-4">
            <WorkbenchCard
              title="信箱回报"
              icon={Inbox}
              action={<Badge variant="outline">{blockedMissions.length} 条卡点</Badge>}
            >
              <div className="space-y-2">
                {blockedMissions.length === 0 ? (
                  <EmptyText text="暂无后台智能体卡点回报。" />
                ) : (
                  blockedMissions.slice(0, 3).map((mission) => (
                    <AlertRow key={mission.id} title={mission.title} tone="destructive" />
                  ))
                )}
                <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  Direct Chat 的 mailbox 模式会在这里汇总完成、失败和等待用户输入的结果。
                </div>
              </div>
            </WorkbenchCard>

            <WorkbenchCard
              title="风险确认"
              icon={ShieldCheck}
              action={<Badge variant="outline">{pendingConfirmations.length} 待处理</Badge>}
            >
              {pendingConfirmations.length === 0 ? (
                <EmptyText text="低风险任务可自动继续，中高风险会进入这里。" />
              ) : (
                <div className="space-y-2">
                  {pendingConfirmations.slice(0, 4).map((mission) => (
                    <AlertRow key={mission.id} title={mission.title} tone="warning" />
                  ))}
                </div>
              )}
            </WorkbenchCard>

            <WorkbenchCard title="会议室与分叉" icon={Users}>
              <div className="grid gap-2">
                <Shortcut href={p.councils()} icon={Users} title="Council Session" desc="临时拉多个 Agent 讨论和决策" />
                <Shortcut href={p.explorations()} icon={Route} title="分叉探索" desc="保留多套方案路径和取舍记录" />
                <Shortcut href={p.skills()} icon={Layers3} title="记忆 / 技能" desc="查看任务沉淀出的长期资产" />
              </div>
            </WorkbenchCard>
          </section>
        </div>
      </div>
    </div>
  );
}

function WorkbenchCard({ title, icon: Icon, action, children, className }: WorkbenchCardProps) {
  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Metric({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      {loading ? <Skeleton className="h-5 w-10" /> : <div className="text-lg font-semibold">{value}</div>}
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function IdeaLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-1.5 rounded-full bg-primary/60" />
      <span>{text}</span>
    </div>
  );
}

function StackSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-md" />
      ))}
    </div>
  );
}

function AgentSkeleton() {
  return <Skeleton className="h-24 w-full rounded-lg" />;
}

function EmptyText({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">{text}</div>;
}

function AlertRow({ title, tone }: { title: string; tone: "warning" | "destructive" }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
      {tone === "warning" ? (
        <AlertTriangle className="size-4 text-warning" />
      ) : (
        <Clock3 className="size-4 text-destructive" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      <ChevronRight className="size-3 text-muted-foreground" />
    </div>
  );
}

function Shortcut({
  href,
  icon: Icon,
  title,
  desc,
}: {
  href: string;
  icon: typeof Users;
  title: string;
  desc: string;
}) {
  return (
    <AppLink href={href} className="flex items-center gap-3 rounded-md border bg-background p-3 transition-colors hover:bg-muted/40">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{desc}</div>
      </div>
    </AppLink>
  );
}

function summarizeRuntimes(runtimes: AgentRuntime[]) {
  const now = Date.now();
  let online = 0;
  const items = runtimes.map((runtime) => {
    const health = deriveRuntimeHealth(runtime, now);
    if (health === "online") online += 1;
    return { runtime, health };
  });
  return { online, items };
}
