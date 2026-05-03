"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Save, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@multica/ui/components/ui/card";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { userProfileOptions, useUpsertUserProfile } from "@multica/core/user-profile";

const ROLE_CARD_MAX = 200;
const COMM_STYLE_MAX = 2000;

export function PreferencesTab() {
  const wsId = useWorkspaceId();
  const profileQuery = useQuery(userProfileOptions(wsId));
  const upsert = useUpsertUserProfile();

  const [roleCard, setRoleCard] = useState("");
  const [communicationStyle, setCommunicationStyle] = useState("");
  const profile = profileQuery.data;

  // Sync local form state when the server profile loads or refetches.
  // Only resync when not currently editing — comparing against the persisted
  // values prevents wiping the user's in-progress edits if the query refetches.
  useEffect(() => {
    if (!profile) return;
    setRoleCard(profile.role_card);
    setCommunicationStyle(profile.communication_style);
    // intentionally only sync on profile change, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.updated_at]);

  const dirty =
    !!profile &&
    (profile.role_card !== roleCard || profile.communication_style !== communicationStyle);

  const handleSave = async () => {
    if (roleCard.length > ROLE_CARD_MAX) {
      toast.error(`身份卡过长（最多 ${ROLE_CARD_MAX} 字符）`);
      return;
    }
    if (communicationStyle.length > COMM_STYLE_MAX) {
      toast.error(`沟通偏好过长（最多 ${COMM_STYLE_MAX} 字符）`);
      return;
    }
    try {
      await upsert.mutateAsync({
        role_card: roleCard,
        communication_style: communicationStyle,
        // Presence and source path are reserved for future tabs — keep
        // existing server values when this form doesn't touch them.
        presence: profile?.presence ?? "online",
        preferences_source_path: profile?.preferences_source_path ?? "",
      });
      toast.success("偏好已保存");
    } catch (err) {
      toast.error("保存失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (profileQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">我的偏好</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          这里写的内容会作为最高优先级注入到所有智能体的对话上下文里。简洁直接最好用——
          智能体每次回话之前都会先读一遍这段。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">身份卡</CardTitle>
          <CardDescription>
            一句话告诉智能体你是谁、在做什么。例如「资深 PM，负责医疗领域的产品设计，重点在儿童生长发育」。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="role-card" className="sr-only">
            身份卡
          </Label>
          <Input
            id="role-card"
            value={roleCard}
            onChange={(e) => setRoleCard(e.target.value)}
            placeholder="一句话介绍自己"
            maxLength={ROLE_CARD_MAX}
          />
          <div className="mt-1 text-right text-xs text-muted-foreground">
            {roleCard.length} / {ROLE_CARD_MAX}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">沟通偏好</CardTitle>
          <CardDescription>
            告诉智能体怎么跟你说话最舒服。比如「业务化语言不要技术术语堆砌」「不喜欢被问 A/B 选择题，给我立场」「段落式表达不要开头加粗总结词」等。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="communication-style" className="sr-only">
            沟通偏好
          </Label>
          <Textarea
            id="communication-style"
            value={communicationStyle}
            onChange={(e) => setCommunicationStyle(e.target.value)}
            placeholder="希望智能体怎么跟你说话？回答风格、用词偏好、禁用句式都可以写。"
            rows={10}
            maxLength={COMM_STYLE_MAX}
            className="font-sans"
          />
          <div className="mt-1 text-right text-xs text-muted-foreground">
            {communicationStyle.length} / {COMM_STYLE_MAX}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <Sparkles className="size-3.5" />
          注入顺序：你的偏好 → 智能体长期上下文 → 当前 Mission 上下文
        </span>
      </div>

      <div className="flex items-center justify-end gap-2">
        {dirty ? (
          <span className="text-xs text-muted-foreground">有未保存的修改</span>
        ) : null}
        <Button
          onClick={handleSave}
          disabled={!dirty || upsert.isPending}
          className="min-w-28"
        >
          {upsert.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          保存偏好
        </Button>
      </div>
    </div>
  );
}
