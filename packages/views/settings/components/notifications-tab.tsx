"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { notificationPreferenceOptions } from "@multica/core/notification-preferences/queries";
import { useUpdateNotificationPreferences } from "@multica/core/notification-preferences/mutations";
import type { NotificationGroupKey, NotificationPreferences } from "@multica/core/types";
import { Card, CardContent } from "@multica/ui/components/ui/card";
import { Switch } from "@multica/ui/components/ui/switch";
import { toast } from "sonner";

const notificationGroups: {
  key: NotificationGroupKey;
  label: string;
  description: string;
}[] = [
  {
    key: "assignments",
    label: "任务分配",
    description: "当你被分配或移出某个任务时通知",
  },
  {
    key: "status_changes",
    label: "状态变更",
    description: "当你关注的任务状态变更时通知（例如待办、进行中、完成）",
  },
  {
    key: "comments",
    label: "评论与提及",
    description: "当你关注的任务有新评论，或有人 @提及你时通知",
  },
  {
    key: "updates",
    label: "优先级与截止时间",
    description: "当你关注的任务优先级或截止时间变更时通知",
  },
  {
    key: "agent_activity",
    label: "智能体动态",
    description: "当智能体任务完成或失败时通知",
  },
];

export function NotificationsTab() {
  const wsId = useWorkspaceId();
  const { data } = useQuery(notificationPreferenceOptions(wsId));
  const mutation = useUpdateNotificationPreferences();

  const preferences = data?.preferences ?? {};

  const handleToggle = (key: NotificationGroupKey, enabled: boolean) => {
    const updated: NotificationPreferences = {
      ...preferences,
      [key]: enabled ? "all" : "muted",
    };
    // Remove keys set to "all" (default) to keep the object clean
    if (enabled) {
      delete updated[key];
    }
    mutation.mutate(updated, {
      onError: () => toast.error("更新通知设置失败"),
    });
  };

  return (
    <div className="space-y-4">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">收件箱通知</h2>
          <p className="text-sm text-muted-foreground mt-1">
            控制哪些事件会生成收件箱通知。静音的事件类型会被自动过滤；你仍然可以进入任务详情查看。
          </p>
        </div>

        <Card>
          <CardContent className="divide-y">
            {notificationGroups.map((group) => {
              const enabled = preferences[group.key] !== "muted";
              return (
                <div
                  key={group.key}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5 pr-4">
                    <p className="text-sm font-medium">{group.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.description}
                    </p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) =>
                      handleToggle(group.key, checked)
                    }
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
