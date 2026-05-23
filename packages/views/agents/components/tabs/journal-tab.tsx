"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@multica/core/api";
import type { Agent, AgentMemory } from "@multica/core/types";
import {
  agentMemoryKeys,
  summarizeActivityWindow,
  useWorkspaceActivityMap,
} from "@multica/core/agents";
import { autopilotListOptions } from "@multica/core/autopilots/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";

interface JournalTabProps {
  agent: Agent;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

type JournalPeriod = "year" | "month";

const PERIODS: Record<
  JournalPeriod,
  {
    label: string;
    ariaLabel: string;
  }
> = {
  year: { label: "年", ariaLabel: "年工作记录日历" },
  month: { label: "月", ariaLabel: "月工作记录日历" },
};

const PERIOD_ORDER: JournalPeriod[] = ["year", "month"];

/**
 * "工作记录" — agent home dashboard mirroring the QoderWake reference:
 * headline numbers and a GitHub-style year heatmap (53 weeks × 7 weekdays).
 * Memory and skills live in their own agent-level tabs, so this page stays
 * focused on work telemetry.
 */
export function JournalTab({ agent }: JournalTabProps) {
  const wsId = useWorkspaceId();
  const [period, setPeriod] = useState<JournalPeriod>("year");
  const { byAgent } = useWorkspaceActivityMap(wsId);
  const activity = byAgent.get(agent.id);
  const summaryDays = period === "month" ? getElapsedDaysInCurrentMonth() : 365;
  const summary = summarizeActivityWindow(activity, summaryDays);
  const { data: autopilots = [] } = useQuery(autopilotListOptions(wsId));

  const triggerCount = useMemo(
    () =>
      autopilots.filter(
        (ap) => ap.assignee_id === agent.id && ap.status === "active",
      ).length,
    [autopilots, agent.id],
  );

  const tenureDays = useMemo(() => {
    const created = new Date(agent.created_at);
    if (Number.isNaN(created.getTime())) return 0;
    return Math.max(
      0,
      Math.floor((Date.now() - created.getTime()) / (24 * 60 * 60 * 1000)),
    );
  }, [agent.created_at]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RecordsPanel
        tenureDays={tenureDays}
        triggerCount={triggerCount}
        completed={summary.totalRuns}
        skillCount={agent.skills?.length ?? 0}
        activity={activity?.buckets ?? []}
        period={period}
        onPeriodChange={setPeriod}
      />
    </div>
  );
}

// ---- Records sub-tab (default) ----------------------------------------

function RecordsPanel({
  tenureDays,
  triggerCount,
  completed,
  skillCount,
  activity,
  period,
  onPeriodChange,
}: {
  tenureDays: number;
  triggerCount: number;
  completed: number;
  skillCount: number;
  activity: readonly { total: number; failed: number }[];
  period: JournalPeriod;
  onPeriodChange: (period: JournalPeriod) => void;
}) {
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>数据周期</span>
        <div
          className="inline-flex rounded-md border bg-background p-0.5"
          aria-label="数据周期"
        >
          {PERIOD_ORDER.map((item) => {
            const active = item === period;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => onPeriodChange(item)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {PERIODS[item].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <BigStat value={tenureDays} unit="天" label="已入职" />
        <BigStat value={triggerCount} unit="个" label="启用中的触发器" />
        <BigStat value={completed} unit="次" label="已完成任务" />
        <BigStat value={skillCount} unit="项" label="已学技能" />
      </div>

      <div className="overflow-x-auto">
        {period === "month" ? (
          <MonthCalendar activity={activity} />
        ) : (
          <YearActivityHeatmap activity={activity} />
        )}
      </div>
    </div>
  );
}

function BigStat({
  value,
  unit,
  label,
}: {
  value: number;
  unit: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 text-center">
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-semibold tabular-nums">{value}</span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ---- Activity calendars ------------------------------------------------

interface HeatCell {
  date: Date;
  daysAgo: number;
  total: number;
  failed: number;
  isFuture: boolean;
  hasData: boolean;
}

function YearActivityHeatmap({
  activity,
}: {
  activity: readonly { total: number; failed: number }[];
}) {
  const weeks = 53;
  const { columns, monthLabels, max } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayWeekday = today.getDay(); // 0=Sun
    const lastColSunday = new Date(today);
    lastColSunday.setDate(today.getDate() - todayWeekday);
    const firstColSunday = new Date(lastColSunday);
    firstColSunday.setDate(lastColSunday.getDate() - 7 * (weeks - 1));

    const cols: HeatCell[][] = [];
    let maxTotal = 0;
    for (let w = 0; w < weeks; w++) {
      const col: HeatCell[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(firstColSunday);
        date.setDate(firstColSunday.getDate() + w * 7 + d);
        const isFuture = date.getTime() > today.getTime();
        const daysAgo = Math.round(
          (today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000),
        );
        const idx = activity.length - 1 - daysAgo;
        const hasData = !isFuture && idx >= 0 && idx < activity.length;
        const bucket = hasData
          ? activity[idx]!
          : { total: 0, failed: 0 };
        if (bucket.total > maxTotal) maxTotal = bucket.total;
        col.push({
          date,
          daysAgo,
          total: bucket.total,
          failed: bucket.failed,
          isFuture,
          hasData,
        });
      }
      cols.push(col);
    }

    // Month labels: pin a label on the first column that introduces a new
    // month (looking at the first day of the column, i.e. that week's
    // Sunday). The label sits on top of that column.
    const labels: { col: number; text: string }[] = [];
    let prevMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const sunday = cols[w]![0]!.date;
      const m = sunday.getMonth();
      if (m !== prevMonth) {
        labels.push({ col: w, text: `${m + 1}月` });
        prevMonth = m;
      }
    }

    return { columns: cols, monthLabels: labels, max: maxTotal };
  }, [activity]);

  return (
    <div
      aria-label={PERIODS.year.ariaLabel}
      style={{ minWidth: 720 }}
    >
      {/* Month label row */}
      <div
        className="grid pl-7 pb-1 text-[10px] text-muted-foreground"
        style={{
          gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
          gap: "2px",
        }}
      >
        {Array.from({ length: weeks }, (_, w) => {
          const lbl = monthLabels.find((l) => l.col === w);
          return (
            <div key={w} className="overflow-visible">
              {lbl ? <span className="whitespace-nowrap">{lbl.text}</span> : null}
            </div>
          );
        })}
      </div>

      <div className="flex gap-1.5">
        {/* Weekday axis (only show 一/三/五 to mimic GitHub) */}
        <div
          className="flex shrink-0 flex-col text-[10px] text-muted-foreground"
          style={{ gap: "2px" }}
        >
          {WEEKDAYS.map((w, i) => (
            <span
              key={i}
              className="flex h-3 items-center"
              style={{ visibility: i % 2 === 1 ? "visible" : "hidden" }}
            >
              {w}
            </span>
          ))}
        </div>

        {/* Heatmap grid */}
        <div
          className="grid flex-1"
          style={{
            gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
            gridTemplateRows: "repeat(7, minmax(0, 1fr))",
            gridAutoFlow: "column",
            gap: "2px",
          }}
        >
          {columns.flat().map((cell, i) => (
            <Cell key={i} cell={cell} max={max} />
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        <span>少</span>
        <LegendCell intensity={0} />
        <LegendCell intensity={1} />
        <LegendCell intensity={2} />
        <LegendCell intensity={3} />
        <LegendCell intensity={4} />
        <span>多</span>
      </div>
    </div>
  );
}

function MonthCalendar({
  activity,
}: {
  activity: readonly { total: number; failed: number }[];
}) {
  const { cells, monthLabel, ariaLabel, max } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const year = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadingBlanks = firstDay.getDay();

    const monthCells: Array<HeatCell | null> = [];
    let maxTotal = 0;
    for (let i = 0; i < 42; i++) {
      const day = i - leadingBlanks + 1;
      if (day < 1 || day > daysInMonth) {
        monthCells.push(null);
        continue;
      }

      const date = new Date(year, month, day);
      date.setHours(0, 0, 0, 0);
      const isFuture = date.getTime() > today.getTime();
      const daysAgo = Math.round(
        (today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000),
      );
      const idx = activity.length - 1 - daysAgo;
      const hasData = !isFuture && idx >= 0 && idx < activity.length;
      const bucket = hasData ? activity[idx]! : { total: 0, failed: 0 };
      if (bucket.total > maxTotal) maxTotal = bucket.total;
      monthCells.push({
        date,
        daysAgo,
        total: bucket.total,
        failed: bucket.failed,
        isFuture,
        hasData,
      });
    }

    return {
      cells: monthCells,
      monthLabel: `${year} 年 ${month + 1} 月`,
      ariaLabel: `${year}年${month + 1}月工作记录日历`,
      max: maxTotal,
    };
  }, [activity]);

  return (
    <div
      aria-label={ariaLabel}
      className="mx-auto w-full max-w-3xl rounded-lg border bg-card p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{monthLabel}</div>
          <div className="text-xs text-muted-foreground">
            按自然月展示每天完成的任务量。
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>少</span>
          <LegendCell intensity={0} />
          <LegendCell intensity={1} />
          <LegendCell intensity={2} />
          <LegendCell intensity={3} />
          <LegendCell intensity={4} />
          <span>多</span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-1">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, index) =>
          cell ? (
            <MonthCell key={cell.date.toISOString()} cell={cell} max={max} />
          ) : (
            <span
              key={`blank-${index}`}
              className="h-9 rounded-md bg-muted/15"
              aria-hidden="true"
            />
          ),
        )}
      </div>
    </div>
  );
}

function intensityClass(intensity: 0 | 1 | 2 | 3 | 4): string {
  if (intensity === 0) return "bg-muted";
  if (intensity === 1) return "bg-emerald-200 dark:bg-emerald-900/60";
  if (intensity === 2) return "bg-emerald-300 dark:bg-emerald-700/80";
  if (intensity === 3) return "bg-emerald-400 dark:bg-emerald-600";
  return "bg-emerald-500 dark:bg-emerald-500";
}

function intensityOf(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value === 0 || max === 0) return 0;
  const ratio = value / max;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

function Cell({ cell, max }: { cell: HeatCell; max: number }) {
  if (cell.isFuture) {
    return <span className="aspect-square w-full" />;
  }
  const intensity = intensityOf(cell.total, max);
  const dateStr = formatLocalDate(cell.date);
  return (
    <span
      title={`${dateStr} · 完成 ${cell.total} · 失败 ${cell.failed}`}
      className={cn(
        "block aspect-square w-full rounded-[2px]",
        intensityClass(intensity),
      )}
    />
  );
}

function MonthCell({ cell, max }: { cell: HeatCell; max: number }) {
  const intensity = intensityOf(cell.total, max);
  const dateStr = formatLocalDate(cell.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = cell.date.getTime() === today.getTime();
  return (
    <span
      aria-label={`${dateStr}${isToday ? "，今天" : ""}`}
      title={`${dateStr} · 完成 ${cell.total} · 失败 ${cell.failed}`}
      className={cn(
        "flex h-9 items-center justify-center rounded-md border text-xs tabular-nums",
        cell.isFuture
          ? "border-transparent bg-muted/10 text-muted-foreground/35"
          : "border-transparent text-foreground",
        !cell.isFuture && intensityClass(intensity),
        isToday && "border-primary/70 ring-1 ring-primary/30",
      )}
    >
      {cell.date.getDate()}
    </span>
  );
}

function LegendCell({ intensity }: { intensity: 0 | 1 | 2 | 3 | 4 }) {
  return (
    <span
      className={cn("inline-block size-2.5 rounded-[2px]", intensityClass(intensity))}
    />
  );
}

function getElapsedDaysInCurrentMonth() {
  return new Date().getDate();
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---- Memory section ----------------------------------------------------

const MEMORY_KIND_LABELS: Record<string, string> = {
  preference: "用户编程偏好",
  project: "项目知识",
  decision: "重要决策",
  problem: "最近遇到的问题",
};

export function MemorySection({
  memories,
  limit = 4,
}: {
  memories: AgentMemory[];
  limit?: number;
}) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  const visible = memories.slice(0, limit);
  const patchMemory = (memory: AgentMemory) => {
    qc.setQueryData<{ memories: AgentMemory[] }>(
      agentMemoryKeys.detail(wsId, memory.agent_id),
      (old) => {
        const current = old?.memories ?? [];
        if (memory.status === "rejected") {
          return { memories: current.filter((item) => item.id !== memory.id) };
        }
        if (current.some((item) => item.id === memory.id)) {
          return {
            memories: current.map((item) => (item.id === memory.id ? memory : item)),
          };
        }
        return { memories: [memory, ...current] };
      },
    );
  };
  const confirmMemory = useMutation({
    mutationFn: (memory: AgentMemory) => api.confirmAgentMemory(memory.agent_id, memory.id),
    onSuccess: (memory) => {
      patchMemory(memory);
      toast.success("记忆已确认");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "确认失败"),
  });
  const rejectMemory = useMutation({
    mutationFn: (memory: AgentMemory) => api.rejectAgentMemory(memory.agent_id, memory.id),
    onSuccess: (memory) => {
      patchMemory(memory);
      toast.success("已拒绝记忆候选");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "拒绝失败"),
  });
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">记忆与积累</span>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            查看完整 memory ›
          </button>
        </div>
      </div>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
        {visible.length > 0 ? (
          visible.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              title={memory.title}
              body={memory.body || MEMORY_KIND_LABELS[memory.kind] || memory.kind}
              age={formatRelative(memory.updated_at)}
              confirming={confirmMemory.isPending}
              rejecting={rejectMemory.isPending}
              onConfirm={() => confirmMemory.mutate(memory)}
              onReject={() => rejectMemory.mutate(memory)}
            />
          ))
        ) : (
          <>
            <MemoryCard
              title="用户编程偏好"
              body="智能体会在持续协作中记下你的偏好（语言习惯、目录结构、注释风格），后续自动复用。"
              age="待积累"
            />
            <MemoryCard
              title="项目知识"
              body="项目内的常用文件、构建命令、运行环境会被自动归纳成可复用上下文。"
              age="待积累"
            />
            <MemoryCard
              title="重要决策"
              body="历史群聊和评论中标注为「决策」的条目会被沉淀，智能体后续会主动遵循。"
              age="待积累"
            />
            <MemoryCard
              title="最近遇到的问题"
              body="任务失败 / 阻塞的根因和解法会留痕，避免下次踩同一坑。"
              age="待积累"
            />
          </>
        )}
      </div>
    </section>
  );
}

function MemoryCard({
  memory,
  title,
  body,
  age,
  confirming,
  rejecting,
  onConfirm,
  onReject,
}: {
  memory?: AgentMemory;
  title: string;
  body: string;
  age: string;
  confirming?: boolean;
  rejecting?: boolean;
  onConfirm?: () => void;
  onReject?: () => void;
}) {
  const isCandidate = memory?.status === "candidate";
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-medium">{title}</div>
        {isCandidate && (
          <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
            候选
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[10px] text-muted-foreground/70">{age}</div>
        {isCandidate && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6"
              disabled={confirming || rejecting}
              onClick={onReject}
              title="拒绝候选"
            >
              <X className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 text-emerald-600 hover:text-emerald-700"
              disabled={confirming || rejecting}
              onClick={onConfirm}
              title="确认记忆"
            >
              <Check className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatRelative(iso: string) {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "今天";
  const days = Math.floor(diff / day);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}
