import { CheckCircle2, Circle, Clock3, Loader2 } from "lucide-react";
import type { DelegationTaskCardStatus } from "@multica/core/types";

export const delegationStatusMeta: Record<
  DelegationTaskCardStatus,
  {
    label: string;
    tone: string;
    icon: typeof Circle;
    terminal: boolean;
    reportReady: boolean;
  }
> = {
  backlog: {
    label: "待办",
    tone: "text-muted-foreground bg-muted/60",
    icon: Circle,
    terminal: false,
    reportReady: false,
  },
  todo: {
    label: "等待中",
    tone: "text-muted-foreground bg-muted/60",
    icon: Circle,
    terminal: false,
    reportReady: false,
  },
  in_progress: {
    label: "处理中",
    tone: "text-amber-500 bg-amber-500/10",
    icon: Loader2,
    terminal: false,
    reportReady: false,
  },
  in_review: {
    label: "已回报",
    tone: "text-emerald-500 bg-emerald-500/10",
    icon: CheckCircle2,
    terminal: true,
    reportReady: true,
  },
  done: {
    label: "已确认",
    tone: "text-emerald-500 bg-emerald-500/10",
    icon: CheckCircle2,
    terminal: true,
    reportReady: true,
  },
  blocked: {
    label: "卡点",
    tone: "text-destructive bg-destructive/10",
    icon: Clock3,
    terminal: false,
    reportReady: false,
  },
  cancelled: {
    label: "已取消",
    tone: "text-muted-foreground bg-muted/60",
    icon: Circle,
    terminal: true,
    reportReady: false,
  },
};

export type DelegationFilter = "all" | "active" | "reported" | "blocked";

export function filterDelegationStatus(
  status: DelegationTaskCardStatus,
  filter: DelegationFilter,
) {
  if (filter === "all") return true;
  if (filter === "active") {
    return status === "todo" || status === "in_progress" || status === "backlog";
  }
  if (filter === "reported") {
    return status === "in_review" || status === "done";
  }
  return status === "blocked";
}
