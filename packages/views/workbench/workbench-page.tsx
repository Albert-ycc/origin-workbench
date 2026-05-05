"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Briefcase,
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
import { useAuthStore } from "@multica/core/auth";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import { api } from "@multica/core/api";
import { useChatStore } from "@multica/core/chat";
import { ideaKeys, ideaListOptions } from "@multica/core/ideas";
import { mailboxListOptions } from "@multica/core/mailbox";
import { missionListOptions } from "@multica/core/missions";
import { projectV12ListOptions } from "@multica/core/projects-v12";
import { deriveRuntimeHealth } from "@multica/core/runtimes";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { Agent, AgentRuntime, Idea, MailboxItem, Mission } from "@multica/core/types";
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

// ────────────────────────────────────────────────────────────────────────
// Starter ideas — Origin §15.5 onboarding 重塑
//
// 上游 Multica 的 onboarding 创建一堆「Issue + Project」教用户怎么 assign
// agent / 切 todo / 配 workspace context — 跟 Origin 主流程（Mission / Idea
// / Council / ToolBinding）完全对不上，sidebar 里也已经把 issue/project 调
// 试入口删了。这里提供 Origin 概念的 starter ideas，新用户首次落到 workbench
// 时（且想法池为空）一次性 seed，让用户在自己熟悉的入口（想法池 / 升级
// Mission / 会议室 / 分叉探索 / 工具绑定）里走一遍主流程。
// ────────────────────────────────────────────────────────────────────────
const STARTER_IDEAS: Array<{ title: string; description: string; tags: string[] }> = [
  {
    title: "把一条还没成形的想法养出来",
    description:
      "想法池是 Origin 的轻量孵化层——半成形的念头不必立刻变成 Mission。在上方输入框写下脑子里的一闪念（「周末把那个原型做了？」「营养库 schema 是不是要重做？」），它先停在这里。等想清楚了，点这条想法的「升级 Mission」按钮：会自动开一间团队房间，产品经理 Agent 把你养护过的笔记当成简报接手，开始拆任务。",
    tags: ["新手任务"],
  },
  {
    title: "去「设置 → 我的偏好」写一条身份卡",
    description:
      "Origin 的每个 Agent 在回话前都先读一遍你写的偏好。比一次次提醒「我是医疗 PM」「请用中文段落式表达」「不要开头加粗总结词」要省事得多。三句话就够：你是谁、最近在做什么、希望 Agent 怎么跟你说话。这是让 Agent 跟你节奏对得上最快的办法。",
    tags: ["新手任务"],
  },
  {
    title: "在会议室里召开一次多角色议事",
    description:
      "纠结的决定别一个人扛——比如「这个表单组件要不要重写」「飞书目录该怎么分」。点左侧「会议室」→ 新建 Council Session，挑产品经理 + 技术架构师 + 测试工程师，让他们各说各话。三档活跃度（quiet / concise / lively）控制 Agent 发言节奏。结束时写一句结论，Origin 会自动把会议结论回写到原来那条 Direct Chat。",
    tags: ["新手任务"],
  },
  {
    title: "用「分叉探索」做一次方案对比",
    description:
      "拿不准三个方案选哪个？去「分叉探索」开一个新探索，给每条方案建一个分支。每个分支必须填齐 7 个字段：方案核心 / 设计逻辑 / 关键决策 / 成本估算 / 风险点 / 适用条件 / 不适用条件。填齐后所有分支并排展开看，差别一目了然，选中标 winning 收尾。",
    tags: ["新手任务"],
  },
  {
    title: "给一个 Mission 绑定真实工作工具",
    description:
      "Mission 详情右栏的「绑定的工具」是 Origin 区别于纯 chat 工具的关键。把飞书 PRD URL、Figma 文件、Obsidian 笔记、本地仓库挂上去，Agent 拿到任务时直接知道资源在哪。默认只读——开「允许写入」开关后，Agent 才能反向推送修改回你的飞书或仓库。",
    tags: ["新手任务"],
  },
];

function starterSeedKey(userId: string | undefined): string | null {
  if (!userId) return null;
  return `origin:starter-ideas-seeded:${userId}`;
}

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
  const { data: ideas = [], isLoading: ideasLoading } = useQuery(ideaListOptions(wsId));
  // v1.2 (PRD §17): 项目工作区是首页主线——把持续推进的事打包成项目并落主聊。
  const { data: projectsV12 = [], isLoading: projectsLoading } = useQuery(projectV12ListOptions(wsId));
  // Workbench block 6: top mailbox reports across all mailbox-mode agents.
  // Limit 5 mirrors the visible row cap below; the user can navigate to the
  // agent detail page (Stage 4 UI) for the full history.
  const { data: mailboxRecent = [] } = useQuery(mailboxListOptions(wsId, { limit: 5 }));
  const recentIdeas = useMemo(
    () => ideas.filter((i) => i.status === "draft" || i.status === "nurturing").slice(0, 3),
    [ideas],
  );

  // Origin 新手任务 seed —— 仅在首次落到工作台、且想法池真为空时种一组
  // 引导任务到当前 workspace。用 localStorage 按 user.id 做幂等：用户归档完
  // 自己的想法回到空池，不会再被 seed 一遍；切换账号则各自有自己的标记。
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const seedingRef = useRef(false);
  useEffect(() => {
    if (!wsId || !userId) return;
    if (ideasLoading) return;
    if (seedingRef.current) return;
    if (typeof window === "undefined") return;
    const key = starterSeedKey(userId);
    if (!key) return;
    if (window.localStorage.getItem(key)) return;

    if (ideas.length > 0) {
      // 用户已经有自己的想法，跳过 seed 但记一下，避免他归档完后再被 seed。
      window.localStorage.setItem(key, "skipped");
      return;
    }

    seedingRef.current = true;
    (async () => {
      try {
        for (const seed of STARTER_IDEAS) {
          await api.createIdea({
            title: seed.title,
            description: seed.description,
            source: "manual",
            tags: seed.tags,
          });
        }
        window.localStorage.setItem(key, "seeded");
        qc.invalidateQueries({ queryKey: ideaKeys.all(wsId) });
      } catch (err) {
        // 不打断 onboarding —— 失败时不写 localStorage，下次进 workbench
        // 如果池子还空会自动重试一次。
        // eslint-disable-next-line no-console
        console.warn("[origin-starter] seed failed", err);
        seedingRef.current = false;
      }
    })();
  }, [wsId, userId, ideas.length, ideasLoading, qc]);

  const activeAgents = useMemo(() => agents.filter(isActiveAgent), [agents]);
  const favoriteAgents = activeAgents.slice(0, 5);
  const openMissions = useMemo(() => missions.filter(activeMission), [missions]);
  const activeProjects = useMemo(
    () => projectsV12.filter((proj) => proj.status === "active"),
    [projectsV12],
  );
  const leaderMissionCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const mission of openMissions) {
      map.set(mission.captain_agent_id, (map.get(mission.captain_agent_id) ?? 0) + 1);
    }
    return map;
  }, [openMissions]);
  const runtimeSummary = useMemo(() => summarizeRuntimes(runtimes), [runtimes]);
  const pendingConfirmations = openMissions.filter((m) => m.status === "waiting_confirmation" || m.risk_level !== "low");
  // Mailbox block 6 surfaces both completed reports (so the user can read
  // the result without going back to chat) and outstanding blocks. Skip
  // still-processing rows — those belong on the agent detail page, not on
  // the inbox-style summary.
  const mailboxReports = useMemo(
    () => mailboxRecent.filter((item) => item.status !== "processing"),
    [mailboxRecent],
  );
  const mailboxBlockedCount = mailboxReports.filter(
    (item) => item.status === "blocked" || item.status === "timeout",
  ).length;
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.name);
    return map;
  }, [agents]);

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
                <Metric label="进行中 Mission" value={openMissions.length} loading={missionsLoading} />
                <Metric label="在线能力" value={runtimeSummary.online} loading={runtimesLoading} />
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
                <AppLink
                  href={p.ideas()}
                  className="block w-full rounded-md border border-dashed bg-background p-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="size-4 text-primary" />
                    捕捉一个未成型想法
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    跳到想法池快速记下，养护成熟后一键升级 Mission。
                  </p>
                </AppLink>
                {ideasLoading ? (
                  <StackSkeleton rows={3} />
                ) : recentIdeas.length === 0 ? (
                  <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                    暂时没有在养护的想法。在上方写下第一条，养熟了一键升级。
                  </div>
                ) : (
                  <div className="rounded-md bg-muted/40 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-muted-foreground">最近养护</div>
                      <Badge variant="outline" className="text-[10px]">
                        {ideas.length} 条
                      </Badge>
                    </div>
                    <ul className="mt-2 space-y-2 text-sm">
                      {recentIdeas.map((idea) => (
                        <li key={idea.id}>
                          <AppLink
                            href={p.ideas()}
                            className="flex items-center gap-2 truncate transition-colors hover:text-primary"
                          >
                            <span className="size-1.5 shrink-0 rounded-full bg-primary/60" />
                            <span className="truncate">{idea.title}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              {ideaTone(idea)}
                            </span>
                          </AppLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
              title="项目工作区"
              icon={Briefcase}
              action={
                <Button variant="outline" size="sm" render={<AppLink href={p.projectWorkspaces()} />}>
                  全部项目
                </Button>
              }
            >
              {projectsLoading ? (
                <StackSkeleton rows={3} />
              ) : activeProjects.length === 0 ? (
                <EmptyText text="把一摊持续工作的事打包成项目，跟智能体在主聊里一起推进。点「全部项目」开第一个。" />
              ) : (
                <div className="divide-y rounded-lg border">
                  {activeProjects.slice(0, 4).map((proj) => (
                    <AppLink
                      key={proj.id}
                      href={p.projectWorkspaceDetail(proj.id)}
                      className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Briefcase className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{proj.title}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {proj.description || "暂无描述"}
                        </div>
                      </div>
                      {proj.compaction_count > 0 ? (
                        <Badge variant="secondary" className="text-[10px]">
                          已压缩 {proj.compaction_count} 次
                        </Badge>
                      ) : null}
                    </AppLink>
                  ))}
                </div>
              )}
            </WorkbenchCard>

            <WorkbenchCard
              title="我的智能体"
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
                  {favoriteAgents.map((agent) => {
                    const leadingCount = leaderMissionCount.get(agent.id) ?? 0;
                    return (
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
                        {leadingCount > 0 ? (
                          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary" className="bg-muted text-muted-foreground">
                              牵头 {leadingCount} 个 Mission
                            </Badge>
                          </div>
                        ) : null}
                      </AppLink>
                    );
                  })}
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
                <EmptyText text="还没有进行中的 Mission。把想法池里养熟的一条点「升级 Mission」，或在项目工作区开个新主聊。" />
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
              action={
                <Badge variant="outline">
                  {mailboxBlockedCount > 0
                    ? `${mailboxBlockedCount} 条卡点`
                    : `${mailboxReports.length} 条新回报`}
                </Badge>
              }
            >
              <div className="space-y-2">
                {mailboxReports.length === 0 ? (
                  <EmptyText text="后台智能体回报会在这里汇总——把某个 Agent 的工作模式切到「信箱」，派活后就能在这里看到完成与卡点。" />
                ) : (
                  mailboxReports.slice(0, 5).map((item) => (
                    <MailboxRow
                      key={item.id}
                      item={item}
                      agentName={agentNameMap.get(item.agent_id) ?? "未知 Agent"}
                    />
                  ))
                )}
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

            <WorkbenchCard title="常用入口" icon={Users}>
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

function ideaTone(idea: Idea): string {
  if (idea.status === "draft") return "草稿";
  const stamp = idea.last_nurtured_at ?? idea.updated_at;
  if (!stamp) return "养护中";
  const diff = Date.now() - new Date(stamp).getTime();
  if (Number.isNaN(diff)) return "养护中";
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "今日";
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))} 周`;
  return `${Math.floor(diff / (30 * day))} 月`;
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

// MailboxRow renders one finished mailbox report on workbench block 6.
// Click opens the originating chat session in the chat overlay so the user
// can see the agent's full reply / follow up — block 6 is a digest, not the
// final destination.
function MailboxRow({ item, agentName }: { item: MailboxItem; agentName: string }) {
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setOpen = useChatStore((s) => s.setOpen);
  const isBlocked = item.status === "blocked" || item.status === "timeout";
  const Icon = isBlocked ? AlertTriangle : Inbox;
  const iconClass = isBlocked ? "text-destructive" : "text-muted-foreground";
  const summary = (isBlocked ? item.blocked_description : item.result).trim();
  const summaryFallback = isBlocked ? "无更多说明" : "已完成";
  return (
    <button
      type="button"
      onClick={() => {
        setActiveSession(item.chat_session_id);
        setOpen(true);
      }}
      className="flex w-full items-start gap-2 rounded-md border bg-background px-3 py-2 text-left hover:bg-muted/40"
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{agentName}</span>
          <Badge
            variant={isBlocked ? "destructive" : "secondary"}
            className="px-1.5 py-0 text-[10px]"
          >
            {mailboxStatusCopy[item.status] ?? item.status}
          </Badge>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {summary || summaryFallback}
        </div>
      </div>
      <ChevronRight className="mt-1 size-3 text-muted-foreground" />
    </button>
  );
}

const mailboxStatusCopy: Record<string, string> = {
  processing: "处理中",
  done: "完成",
  blocked: "卡点",
  timeout: "超时",
};

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
