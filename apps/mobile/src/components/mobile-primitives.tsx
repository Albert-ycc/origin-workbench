import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  Pause,
  Play,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type {
  AgentStatus,
  InboxItemStatus,
  InboxItemType,
  MissionStatus,
  MissionTimelineStatus,
  OriginPriority,
} from "../types";

const priorityTone: Record<OriginPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  high: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  critical: "bg-destructive/10 text-destructive",
};

const missionStatusLabel: Record<MissionStatus, string> = {
  running: "执行中",
  waiting: "等待",
  paused: "已暂停",
  done: "已完成",
  blocked: "受阻",
};

const agentStatusLabel: Record<AgentStatus, string> = {
  idle: "待命",
  working: "工作中",
  offline: "离线",
};

const inboxTypeLabel: Record<InboxItemType, string> = {
  risk: "风险",
  confirmation: "确认",
  result: "回报",
};

const inboxStatusLabel: Record<InboxItemStatus, string> = {
  unread: "未读",
  pending: "待处理",
  resolved: "已处理",
};

interface MobilePageProps {
  title: string;
  subtitle?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
}

export function MobilePage({ title, subtitle, leftSlot, rightSlot, children }: MobilePageProps) {
  return (
    <section className="mobile-page min-h-0 bg-transparent text-foreground">
      <header className="sticky top-0 z-10 -mx-1 mb-3 border-b border-border/70 bg-background/95 px-1 pb-3 pt-1 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          {leftSlot ? <div className="shrink-0 pt-0.5">{leftSlot}</div> : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[1.35rem] font-semibold leading-tight">{title}</h1>
            {subtitle ? (
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 pb-5">{children}</div>
    </section>
  );
}

interface SectionProps {
  title: string;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function MobileSection({ title, meta, action, children }: SectionProps) {
  return (
    <section className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {meta ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

interface StatusPillProps {
  children: ReactNode;
  tone?: "default" | "muted" | "success" | "warning" | "danger" | "primary";
}

export function StatusPill({ children, tone = "default" }: StatusPillProps) {
  const toneClass = {
    default: "bg-secondary text-secondary-foreground",
    muted: "bg-muted text-muted-foreground",
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    danger: "bg-destructive/10 text-destructive",
    primary: "bg-primary/10 text-primary",
  }[tone];

  return (
    <span className={`inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

interface ActionButtonProps {
  children: ReactNode;
  intent?: "neutral" | "primary" | "danger";
  type?: "button" | "submit";
  onClick?: () => void;
}

export function ActionButton({
  children,
  intent = "neutral",
  type = "button",
  onClick,
}: ActionButtonProps) {
  const intentClass = {
    neutral: "border-border bg-background text-foreground active:bg-muted",
    primary: "border-primary bg-primary text-primary-foreground active:bg-primary/85",
    danger: "border-destructive/30 bg-destructive/10 text-destructive active:bg-destructive/20",
  }[intent];

  return (
    <button
      type={type}
      onClick={onClick}
      className={`inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${intentClass}`}
    >
      {children}
    </button>
  );
}

export function PriorityPill({ priority }: { priority: OriginPriority }) {
  const label: Record<OriginPriority, string> = {
    low: "低",
    medium: "中",
    high: "高",
    critical: "紧急",
  };

  return (
    <span className={`inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ${priorityTone[priority]}`}>
      {label[priority]}
    </span>
  );
}

export function MissionStatusPill({ status }: { status: MissionStatus }) {
  const tone = status === "running" ? "primary" : status === "blocked" ? "danger" : status === "done" ? "success" : "muted";
  return <StatusPill tone={tone}>{missionStatusLabel[status]}</StatusPill>;
}

export function AgentStatusPill({ status }: { status: AgentStatus }) {
  const tone = status === "working" ? "primary" : status === "offline" ? "muted" : "success";
  return <StatusPill tone={tone}>{agentStatusLabel[status]}</StatusPill>;
}

export function InboxTypePill({ type }: { type: InboxItemType }) {
  const tone = type === "risk" ? "danger" : type === "confirmation" ? "warning" : "success";
  return <StatusPill tone={tone}>{inboxTypeLabel[type]}</StatusPill>;
}

export function InboxStatusPill({ status }: { status: InboxItemStatus }) {
  const tone = status === "resolved" ? "success" : status === "pending" ? "warning" : "primary";
  return <StatusPill tone={tone}>{inboxStatusLabel[status]}</StatusPill>;
}

export function TimelineIcon({ status }: { status: MissionTimelineStatus }) {
  const className = "size-4";
  if (status === "done") return <CheckCircle2 className={`${className} text-emerald-600`} />;
  if (status === "running") return <Play className={`${className} text-primary`} />;
  if (status === "blocked") return <XCircle className={`${className} text-destructive`} />;
  return <Clock3 className={`${className} text-muted-foreground`} />;
}

export function MissionControlIcon({ action }: { action: "pause" | "resume" | "abort" }) {
  const className = "size-4";
  if (action === "pause") return <Pause className={className} />;
  if (action === "resume") return <Play className={className} />;
  return <ShieldAlert className={className} />;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <Circle className="mb-2 size-5 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

export function RiskIcon() {
  return <AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" />;
}
