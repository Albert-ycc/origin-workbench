"use client";

import { STATUS_CONFIG, PRIORITY_CONFIG } from "@multica/core/issues/config";
import { useActorName } from "@multica/core/workspace/hooks";
import { StatusIcon, PriorityIcon } from "../../issues/components";
import type { InboxItem, InboxItemType, IssueStatus, IssuePriority } from "@multica/core/types";
import { getQuickCreateFailureDetail } from "./inbox-display";

const typeLabels: Record<InboxItemType, string> = {
  issue_assigned: "已分配",
  unassigned: "未分配",
  assignee_changed: "负责人已变更",
  status_changed: "状态已变更",
  priority_changed: "优先级已变更",
  due_date_changed: "截止时间已变更",
  new_comment: "新评论",
  mentioned: "提到了你",
  review_requested: "请求审核",
  task_completed: "任务已完成",
  task_failed: "任务失败",
  agent_blocked: "智能体受阻",
  agent_completed: "智能体已完成",
  reaction_added: "有新回应",
  quick_create_done: "智能体已创建",
  quick_create_failed: "智能体创建失败",
};

export { typeLabels };

function shortDate(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

export function InboxDetailLabel({ item }: { item: InboxItem }) {
  const { getActorName } = useActorName();
  const details = item.details ?? {};

  switch (item.type) {
    case "status_changed": {
      if (!details.to) return <span>{typeLabels[item.type]}</span>;
      const label = STATUS_CONFIG[details.to as IssueStatus]?.label ?? details.to;
      return (
        <span className="inline-flex items-center gap-1">
          状态设为
          <StatusIcon status={details.to as IssueStatus} className="h-3 w-3" />
          {label}
        </span>
      );
    }
    case "priority_changed": {
      if (!details.to) return <span>{typeLabels[item.type]}</span>;
      const label = PRIORITY_CONFIG[details.to as IssuePriority]?.label ?? details.to;
      return (
        <span className="inline-flex items-center gap-1">
          优先级设为
          <PriorityIcon priority={details.to as IssuePriority} className="h-3 w-3" />
          {label}
        </span>
      );
    }
    case "issue_assigned": {
      if (details.new_assignee_id) {
        return <span>已分配给 {getActorName(details.new_assignee_type ?? "member", details.new_assignee_id)}</span>;
      }
      return <span>{typeLabels[item.type]}</span>;
    }
    case "unassigned":
      return <span>已移除负责人</span>;
    case "assignee_changed": {
      if (details.new_assignee_id) {
        return <span>已分配给 {getActorName(details.new_assignee_type ?? "member", details.new_assignee_id)}</span>;
      }
      return <span>{typeLabels[item.type]}</span>;
    }
    case "due_date_changed": {
      if (details.to) return <span>截止时间设为 {shortDate(details.to)}</span>;
      return <span>已移除截止时间</span>;
    }
    case "new_comment": {
      if (item.body) return <span>{item.body}</span>;
      return <span>{typeLabels[item.type]}</span>;
    }
    case "reaction_added": {
      const emoji = details.emoji;
      if (emoji) return <span>用 {emoji} 回应了你的评论</span>;
      return <span>{typeLabels[item.type]}</span>;
    }
    case "quick_create_done": {
      const identifier = details.identifier;
      if (identifier) return <span>智能体已创建：{identifier}</span>;
      return <span>{typeLabels[item.type]}</span>;
    }
    case "quick_create_failed": {
      const detail = getQuickCreateFailureDetail(item);
      if (detail) return <span>失败：{detail}</span>;
      return <span>{typeLabels[item.type]}</span>;
    }
    default:
      return <span>{typeLabels[item.type] ?? item.type}</span>;
  }
}
