"use client";

import React from "react";
import { User, Palette, Key, Bell, SlidersHorizontal } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@multica/ui/components/ui/tabs";
import { AccountTab } from "./account-tab";
import { AppearanceTab } from "./appearance-tab";
import { TokensTab } from "./tokens-tab";
import { NotificationsTab } from "./notifications-tab";
import { PreferencesTab } from "./preferences-tab";

// Origin is a single-user local workbench. The legacy multi-tenant settings
// (workspace info / repos / labs / members) and the upstream auto-updater
// were removed — they conflict with §2.1 "no multi-user", §15 "Fairy is a
// hard-coded workspace", and the fact that auto-update would overwrite the
// forked product with stock Multica releases.
const accountTabs = [
  { value: "profile", label: "个人资料", icon: User },
  { value: "preferences", label: "我的偏好", icon: SlidersHorizontal },
  { value: "appearance", label: "外观", icon: Palette },
  { value: "notifications", label: "通知", icon: Bell },
  { value: "tokens", label: "API 令牌", icon: Key },
];

export interface ExtraSettingsTab {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  content: React.ReactNode;
}

interface SettingsPageProps {
  /** Additional tabs injected by platform (e.g. desktop daemon settings) */
  extraAccountTabs?: ExtraSettingsTab[];
}

export function SettingsPage({ extraAccountTabs }: SettingsPageProps = {}) {
  return (
    <Tabs defaultValue="profile" orientation="vertical" className="flex-1 min-h-0 gap-0">
      {/* Left nav */}
      <div className="w-52 shrink-0 border-r overflow-y-auto p-4">
        <h1 className="text-sm font-semibold mb-4 px-2">设置</h1>
        <TabsList variant="line" className="flex-col items-stretch">
          {accountTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}
          {extraAccountTabs?.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Right content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="w-full max-w-3xl mx-auto p-6">
          <TabsContent value="profile"><AccountTab /></TabsContent>
          <TabsContent value="preferences"><PreferencesTab /></TabsContent>
          <TabsContent value="appearance"><AppearanceTab /></TabsContent>
          <TabsContent value="notifications"><NotificationsTab /></TabsContent>
          <TabsContent value="tokens"><TokensTab /></TabsContent>
          {extraAccountTabs?.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>{tab.content}</TabsContent>
          ))}
        </div>
      </div>
    </Tabs>
  );
}
