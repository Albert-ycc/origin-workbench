"use client";

import { Cloud, Cpu, Gauge, Monitor } from "lucide-react";
import type { ReactNode } from "react";
import type {
  Agent,
  AgentRuntime,
  MemberWithUser,
} from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { PropRow } from "../../../common/prop-row";
import { ProviderLogo } from "../../../runtimes/components/provider-logo";
import { RuntimePicker } from "../inspector/runtime-picker";
import { ModelPicker } from "../inspector/model-picker";
import { ConcurrencyPicker } from "../inspector/concurrency-picker";
import {
  hasModelCliOverride,
  ModelConflictWarning,
} from "./model-conflict-warning";

type RuntimeProps = {
  agent: Agent;
  runtimes: AgentRuntime[];
  members: MemberWithUser[];
  currentUserId: string | null;
  canEdit: boolean;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
};

type ModelProps = Omit<RuntimeProps, "members" | "currentUserId">;

export function ModelSettingsTab({
  agent,
  runtimes,
  canEdit,
  onUpdate,
}: ModelProps) {
  const runtime = agent.runtime_id
    ? runtimes.find((r) => r.id === agent.runtime_id) ?? null
    : null;
  const modelIsDedicated = agent.model.trim().length > 0;
  const hasModelConflict = hasModelCliOverride(agent.custom_args);

  return (
    <div className="space-y-5">
      <SectionTitle
        title="模型"
        description="这个字段只影响当前智能体；为空时继承运行环境或提供商默认模型。"
      />

      {hasModelConflict && <ModelConflictWarning />}

      <div className="rounded-lg border bg-card p-4">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <PropRow label="当前环境" interactive={false}>
            <span className="truncate">
              {runtime?.name ?? "未选择运行环境"}
            </span>
          </PropRow>
          <PropRow label="模型">
            <ModelPicker
              runtimes={runtimes}
              runtimeId={runtime?.id ?? null}
              value={agent.model}
              canEdit={canEdit}
              onChange={(model, nextRuntimeId) =>
                onUpdate(agent.id, { model, runtime_id: nextRuntimeId })
              }
            />
          </PropRow>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        <InfoTile
          icon={
            runtime ? (
              <ProviderLogo provider={runtime.provider} className="size-4" />
            ) : (
              <Cpu className="size-4" />
            )
          }
          label="模型策略"
          value={modelIsDedicated ? agent.model : "继承默认"}
          caption={
            modelIsDedicated
              ? "只影响当前智能体，不会同步到其他智能体"
              : "随运行环境默认模型变化"
          }
          tone={modelIsDedicated ? "primary" : "muted"}
        />
        <InfoTile
          icon={<Cpu className="size-4" />}
          label="配置来源"
          value={hasModelConflict ? "存在 CLI 覆盖" : "页面字段"}
          caption={
            hasModelConflict
              ? "自定义参数里还有模型参数，建议清理"
              : "实际启动优先读取当前页面模型字段"
          }
          tone={hasModelConflict ? "warning" : "success"}
        />
      </section>
    </div>
  );
}

export function RuntimeSettingsTab({
  agent,
  runtimes,
  members,
  currentUserId,
  canEdit,
  onUpdate,
}: RuntimeProps) {
  const runtime = agent.runtime_id
    ? runtimes.find((r) => r.id === agent.runtime_id) ?? null
    : null;
  const RuntimeIcon = runtime?.runtime_mode === "cloud" ? Cloud : Monitor;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="运行环境"
        description="决定这个智能体在哪个本地或云端 runtime 上执行，以及同一时间能跑多少任务。"
      />

      <div className="rounded-lg border bg-card p-4">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <PropRow label="运行环境">
            <RuntimePicker
              value={agent.runtime_id}
              runtimes={runtimes}
              members={members}
              currentUserId={currentUserId}
              canEdit={canEdit}
              onChange={(runtime_id) => onUpdate(agent.id, { runtime_id })}
            />
          </PropRow>
          <PropRow label="并发任务">
            <ConcurrencyPicker
              value={agent.max_concurrent_tasks}
              canEdit={canEdit}
              onChange={(max_concurrent_tasks) =>
                onUpdate(agent.id, { max_concurrent_tasks })
              }
            />
          </PropRow>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        <InfoTile
          icon={<RuntimeIcon className="size-4" />}
          label="运行环境"
          value={runtime?.name ?? "未选择"}
          caption={
            runtime
              ? runtime.status === "online"
                ? "在线，可调度"
                : "离线，任务会等待"
              : "需要绑定一个 runtime"
          }
          tone={runtime?.status === "online" ? "success" : "muted"}
        />
        <InfoTile
          icon={<Gauge className="size-4" />}
          label="并发上限"
          value={`${agent.max_concurrent_tasks}`}
          caption="同一智能体同时执行的任务数"
          tone="muted"
        />
      </section>
    </div>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function InfoTile({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption: string;
  tone: "primary" | "success" | "warning" | "muted";
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <Badge
          variant="outline"
          className={
            tone === "primary"
              ? "border-primary/30 text-primary"
              : tone === "success"
                ? "border-success/30 text-success"
                : tone === "warning"
                  ? "border-warning/30 text-warning"
                  : "text-muted-foreground"
          }
        >
          {label}
        </Badge>
      </div>
      <div className="mt-3 truncate text-sm font-medium" title={value}>
        {value}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}
