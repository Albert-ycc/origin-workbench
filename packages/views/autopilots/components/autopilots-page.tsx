"use client";

import { useState } from "react";
import { Plus, Zap, Play, Pause, AlertCircle, Newspaper, GitPullRequest, Bug, BarChart3, Shield, FileSearch } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { autopilotListOptions } from "@multica/core/autopilots/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { useActorName } from "@multica/core/workspace/hooks";
import { AppLink } from "../../navigation";
import { ActorAvatar } from "../../common/actor-avatar";
import { PageHeader } from "../../layout/page-header";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { AutopilotDialog } from "./autopilot-dialog";
import type { Autopilot } from "@multica/core/types";
import type { TriggerFrequency } from "./trigger-config";

interface AutopilotTemplate {
  title: string;
  prompt: string;
  summary: string;
  icon: typeof Zap;
  frequency: TriggerFrequency;
  time: string;
}

const TEMPLATES: AutopilotTemplate[] = [
  {
    title: "每日新闻摘要",
    summary: "搜索并汇总当天新闻，发给团队",
    prompt: `1. 只搜索今天发布的新闻和公告
2. 筛选与团队和行业相关的主题
3. 为每条内容写短摘要，包括标题、来源和关键结论
4. 汇总成一份简洁摘要
5. 将摘要作为评论发布到这个任务，并 @提及所有工作区成员`,
    icon: Newspaper,
    frequency: "daily",
    time: "09:00",
  },
  {
    title: "PR 评审提醒",
    summary: "标记长期未评审的 Pull Request",
    prompt: `1. 列出代码仓库中所有开放的 Pull Request
2. 找出超过 24 小时仍未被评审的 PR
3. 为每个过期 PR 记录作者、等待时间和一句话变更摘要
4. 在这个任务下评论所有过期 PR 及链接
5. @提及团队成员提醒评审`,
    icon: GitPullRequest,
    frequency: "weekdays",
    time: "10:00",
  },
  {
    title: "Bug 分诊",
    summary: "评估并排序新的 Bug 反馈",
    prompt: `1. 列出所有状态为“待分诊”或“待整理”且尚未设置优先级的任务
2. 阅读每个任务描述，以及附带的日志或截图
3. 根据用户影响和范围评估严重程度（紧急 / 高 / 中 / 低）
4. 相应设置任务优先级
5. 添加评论说明评估理由和建议下一步`,
    icon: Bug,
    frequency: "weekdays",
    time: "09:00",
  },
  {
    title: "周进展报告",
    summary: "整理团队一周进展总结",
    prompt: `1. 收集过去 7 天完成的所有任务
2. 收集当前进行中的所有任务
3. 找出受阻任务及阻塞原因
4. 统计关键指标：关闭任务数、新增任务数、净变化
5. 写一份结构化周报，包含：已完成、进行中、受阻、指标
6. 将报告作为评论发布到这个任务`,
    icon: BarChart3,
    frequency: "weekly",
    time: "17:00",
  },
  {
    title: "依赖安全审计",
    summary: "扫描安全漏洞和过期依赖",
    prompt: `1. 在项目中运行依赖审计工具（如 npm audit、go vuln check 等）
2. 找出存在已知安全漏洞的依赖包
3. 列出落后超过 2 个大版本的依赖包
4. 为每项发现记录严重程度、受影响包和建议修复方式
5. 发布一份包含可执行事项的摘要报告`,
    icon: Shield,
    frequency: "weekly",
    time: "08:00",
  },
  {
    title: "文档缺口检查",
    summary: "检查近期变更是否缺少文档",
    prompt: `1. 通过 git log 列出过去 7 天合入的代码变更
2. 对每个重要变更检查相关文档是否同步更新
3. 找出缺少文档的新 API、配置项或功能
4. 列出文档缺口、文件路径和建议补充内容
5. 将发现作为评论发布到这个任务`,
    icon: FileSearch,
    frequency: "weekly",
    time: "14:00",
  },
];

function formatRelativeDate(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1) return "今天";
  if (days === 1) return "1 天前";
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Zap }> = {
  active: { label: "启用", color: "text-emerald-500", icon: Play },
  paused: { label: "暂停", color: "text-amber-500", icon: Pause },
  archived: { label: "已归档", color: "text-muted-foreground", icon: AlertCircle },
};

const EXECUTION_MODE_LABELS: Record<string, string> = {
  create_issue: "创建任务",
  run_only: "仅运行",
};

function AutopilotRow({ autopilot }: { autopilot: Autopilot }) {
  const { getActorName } = useActorName();
  const wsPaths = useWorkspacePaths();
  const statusCfg = (STATUS_CONFIG[autopilot.status] ?? STATUS_CONFIG["active"])!;
  const StatusIcon = statusCfg.icon;

  return (
    <div className="group/row flex h-11 items-center gap-2 px-5 text-sm transition-colors hover:bg-accent/40">
      <AppLink
        href={wsPaths.autopilotDetail(autopilot.id)}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <Zap className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{autopilot.title}</span>
      </AppLink>

      {/* Agent */}
      <span className="flex w-32 items-center gap-1.5 shrink-0">
        <ActorAvatar actorType="agent" actorId={autopilot.assignee_id} size={18} enableHoverCard showStatusDot />
        <span className="truncate text-xs text-muted-foreground">
          {getActorName("agent", autopilot.assignee_id)}
        </span>
      </span>

      {/* Mode */}
      <span className="w-24 shrink-0 text-center text-xs text-muted-foreground">
        {EXECUTION_MODE_LABELS[autopilot.execution_mode] ?? autopilot.execution_mode}
      </span>

      {/* Status */}
      <span className={cn("flex w-20 items-center justify-center gap-1 shrink-0 text-xs", statusCfg.color)}>
        <StatusIcon className="h-3 w-3" />
        {statusCfg.label}
      </span>

      {/* Last run */}
      <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {autopilot.last_run_at ? formatRelativeDate(autopilot.last_run_at) : "--"}
      </span>
    </div>
  );
}

export function AutopilotsPage() {
  const wsId = useWorkspaceId();
  const { data: autopilots = [], isLoading } = useQuery(autopilotListOptions(wsId));
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<AutopilotTemplate | null>(null);

  const openCreate = (template?: AutopilotTemplate) => {
    setSelectedTemplate(template ?? null);
    setCreateOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <PageHeader className="justify-between px-5">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">自动巡航</h1>
          {!isLoading && autopilots.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{autopilots.length}</span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => openCreate()}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          新建自动巡航
        </Button>
      </PageHeader>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <>
            <div className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b bg-muted/30 px-5">
              <span className="shrink-0 w-4" />
              <Skeleton className="h-3 w-12 flex-1 max-w-[48px]" />
              <Skeleton className="h-3 w-12 shrink-0" />
              <Skeleton className="h-3 w-10 shrink-0" />
              <Skeleton className="h-3 w-10 shrink-0" />
              <Skeleton className="h-3 w-12 shrink-0" />
            </div>
            <div className="p-5 pt-1 space-y-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          </>
        ) : autopilots.length === 0 ? (
          <div className="flex flex-col items-center py-16 px-5">
            <Zap className="h-10 w-10 mb-3 text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground">暂无自动巡航</p>
            <p className="text-xs text-muted-foreground mt-1 mb-6">
              为 AI 智能体设置周期性任务。选择模板，或从空白开始。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-3xl">
              {TEMPLATES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.title}
                    type="button"
                    className="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/40"
                    onClick={() => openCreate(t)}
                  >
                    <Icon className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.summary}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => openCreate()}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              从空白开始
            </Button>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b bg-muted/30 px-5 text-xs font-medium text-muted-foreground">
              <span className="shrink-0 w-4" />
              <span className="min-w-0 flex-1">名称</span>
              <span className="w-32 shrink-0">智能体</span>
              <span className="w-24 text-center shrink-0">模式</span>
              <span className="w-20 text-center shrink-0">状态</span>
              <span className="w-20 text-right shrink-0">上次运行</span>
            </div>
            {autopilots.map((autopilot) => (
              <AutopilotRow key={autopilot.id} autopilot={autopilot} />
            ))}
          </>
        )}
      </div>

      {createOpen && (
        <AutopilotDialog
          mode="create"
          open={createOpen}
          onOpenChange={setCreateOpen}
          initial={
            selectedTemplate
              ? { title: selectedTemplate.title, description: selectedTemplate.prompt }
              : undefined
          }
          initialTriggerConfig={
            selectedTemplate
              ? { frequency: selectedTemplate.frequency, time: selectedTemplate.time }
              : undefined
          }
        />
      )}
    </div>
  );
}
