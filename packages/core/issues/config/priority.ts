import type { IssuePriority } from "../../types";

export const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export const PRIORITY_CONFIG: Record<
  IssuePriority,
  { label: string; bars: number; color: string; badgeBg: string; badgeText: string }
> = {
  urgent: { label: "紧急", bars: 4, color: "text-destructive", badgeBg: "bg-priority", badgeText: "text-white" },
  high: { label: "高", bars: 3, color: "text-warning", badgeBg: "bg-priority/80", badgeText: "text-white" },
  medium: { label: "中", bars: 2, color: "text-warning", badgeBg: "bg-priority/15", badgeText: "text-priority" },
  low: { label: "低", bars: 1, color: "text-info", badgeBg: "bg-priority/10", badgeText: "text-priority" },
  none: { label: "无优先级", bars: 0, color: "text-muted-foreground", badgeBg: "bg-muted", badgeText: "text-muted-foreground" },
};
