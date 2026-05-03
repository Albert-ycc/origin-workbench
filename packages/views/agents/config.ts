import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
} from "lucide-react";

export const taskStatusConfig: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  queued: { label: "排队中", icon: Clock, color: "text-muted-foreground" },
  dispatched: { label: "已分发", icon: Play, color: "text-info" },
  running: { label: "运行中", icon: Loader2, color: "text-brand" },
  completed: { label: "已完成", icon: CheckCircle2, color: "text-success" },
  failed: { label: "失败", icon: XCircle, color: "text-destructive" },
  cancelled: { label: "已取消", icon: XCircle, color: "text-muted-foreground" },
};
