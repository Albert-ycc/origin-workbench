"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, LogOut, Save } from "lucide-react";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Button } from "@multica/ui/components/ui/button";
import { Card, CardContent } from "@multica/ui/components/ui/card";
import { toast } from "sonner";
import { useAuthStore } from "@multica/core/auth";
import { api } from "@multica/core/api";
import { useFileUpload } from "@multica/core/hooks/use-file-upload";
import { useLogout } from "../../auth";
import { resolveUserAvatarUrl } from "../../common/default-avatar";

export function AccountTab() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useLogout();

  const [profileName, setProfileName] = useState(user?.name ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const { upload, uploading } = useFileUpload(api);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProfileName(user?.name ?? "");
  }, [user]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected
    e.target.value = "";
    try {
      const result = await upload(file);
      if (!result) return;
      const updated = await api.updateMe({ avatar_url: result.link });
      setUser(updated);
      toast.success("头像已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传头像失败");
    }
  };

  const handleProfileSave = async () => {
    setProfileSaving(true);
    try {
      const updated = await api.updateMe({ name: profileName });
      setUser(updated);
      toast.success("个人资料已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新个人资料失败");
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">个人资料</h2>

        <Card>
          <CardContent className="space-y-4">
            {/* Avatar upload */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="group relative h-16 w-16 shrink-0 rounded-full bg-muted overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <img
                  src={resolveUserAvatarUrl(user?.avatar_url, user?.name)}
                  alt={user?.name ?? "本地用户"}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  ) : (
                    <Camera className="h-5 w-5 text-white" />
                  )}
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <div className="text-xs text-muted-foreground">
                点击上传头像
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">姓名</Label>
              <Input
                type="search"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                size="sm"
                onClick={handleProfileSave}
                disabled={profileSaving || !profileName.trim()}
              >
                <Save className="h-3 w-3" />
                {profileSaving ? "更新中..." : "更新个人资料"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">会话</h2>
        <Card>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">退出登录</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  清除当前设备上的登录状态和本地会话缓存。
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={logout}>
                <LogOut className="h-3.5 w-3.5" />
                退出登录
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
