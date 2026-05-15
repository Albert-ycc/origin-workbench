import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  KeyRound,
  RefreshCw,
  ServerCog,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { runtimeKeys, runtimeListOptions } from "@multica/core/runtimes/queries";
import type { AgentRuntime } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@multica/ui/components/ui/card";
import { cn } from "@multica/ui/lib/utils";

const API_RUNTIME_MARKER = "origin_api";
const REQUIRED_ENV = ["ORIGIN_MODEL_API_KEY", "ORIGIN_MODEL_NAME"];
const OPTIONAL_ENV = [
  "ORIGIN_MODEL_PROVIDER",
  "ORIGIN_MODEL_BASE_URL",
  "ORIGIN_MODEL_NAMES",
  "ORIGIN_MODEL_RUNTIME_NAME",
  "ORIGIN_MODEL_TOOL_ROOTS",
];

interface ModelApiMetadata {
  api_runtime?: boolean;
  managed_by?: string;
  config_source?: string;
  api_key_configured?: boolean;
  base_url_configured?: boolean;
  supports_tools?: boolean;
  task_execution?: string;
  default_model?: string;
  required_env?: unknown;
  optional_env?: unknown;
  models?: unknown;
}

interface RuntimeModel {
  id: string;
  label?: string;
  provider?: string;
  default?: boolean;
}

function asMetadata(runtime?: AgentRuntime | null): ModelApiMetadata {
  if (!runtime?.metadata || typeof runtime.metadata !== "object") return {};
  return runtime.metadata as ModelApiMetadata;
}

function isModelApiRuntime(runtime: AgentRuntime) {
  const metadata = asMetadata(runtime);
  return metadata.api_runtime === true && metadata.managed_by === API_RUNTIME_MARKER;
}

function stringList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return items.length > 0 ? items : fallback;
}

function runtimeModels(value: unknown): RuntimeModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length === 0) return [];
    return [
      {
        id: record.id,
        label: typeof record.label === "string" ? record.label : undefined,
        provider: typeof record.provider === "string" ? record.provider : undefined,
        default: record.default === true,
      },
    ];
  });
}

function buildEnvSnippet(defaultModel: string) {
  return [
    "# 方式 A：Origin 专属变量",
    'export ORIGIN_MODEL_PROVIDER="openai_compatible"',
    'export ORIGIN_MODEL_API_KEY="sk-..."',
    `export ORIGIN_MODEL_NAME="${defaultModel}"`,
    "",
    "# 可选：对接兼容 OpenAI Chat Completions 的网关时再配置",
    'export ORIGIN_MODEL_BASE_URL="https://api.openai.com/v1"',
    `export ORIGIN_MODEL_NAMES="${defaultModel}"`,
    'export ORIGIN_MODEL_RUNTIME_NAME="大模型 API"',
    "",
    "# 可选：限制 API runtime 可读取和搜索的本地目录，多个目录用逗号分隔",
    'export ORIGIN_MODEL_TOOL_ROOTS="/Users/albert/OriginWorkbenchMount"',
    "",
    "# 方式 B：中转站 / cc-switch / Codex 兼容变量",
    "# 如果没有 ORIGIN_MODEL_*，Origin 会自动读取这些变量",
    'export OPENAI_API_KEY="sk-..."',
    'export OPENAI_BASE_URL="https://your-relay.example/v1"',
    `export OPENAI_MODEL="${defaultModel}"`,
  ].join("\n");
}

function FieldRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[128px_minmax(0,1fr)] items-baseline gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn("min-w-0 truncate text-sm", mono && "font-mono text-xs")}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function ModelApiSettingsTab() {
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const runtimesQuery = useQuery(runtimeListOptions(wsId));

  const apiRuntime = useMemo(
    () => runtimesQuery.data?.find(isModelApiRuntime) ?? null,
    [runtimesQuery.data],
  );
  const metadata = asMetadata(apiRuntime);
  const models = runtimeModels(metadata.models);
  const defaultModel =
    metadata.default_model ??
    models.find((model) => model.default)?.id ??
    models[0]?.id ??
    "gpt-4.1-mini";
  const requiredEnv = stringList(metadata.required_env, REQUIRED_ENV);
  const optionalEnv = stringList(metadata.optional_env, OPTIONAL_ENV);
  const configured = Boolean(apiRuntime && metadata.api_key_configured);
  const ready = Boolean(configured && apiRuntime?.status === "online" && models.length > 0);
  const envSnippet = buildEnvSnippet(defaultModel);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: runtimeKeys.list(wsId) });
    toast.success("正在刷新大模型 API 状态");
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(envSnippet);
      toast.success("环境变量片段已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">大模型 API</h2>
          <p className="text-sm text-muted-foreground mt-1">
            对接 OpenAI 兼容的 Chat Completions API、中转站或 cc-switch / Codex 配置，并由 Origin
            补上工具循环和只读本地文件工具。
            Shell、浏览器、MCP 等能力仍需要完整本地 Agent runtime。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={runtimesQuery.isFetching}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", runtimesQuery.isFetching && "animate-spin")}
          />
          刷新
        </Button>
      </div>

      <div className="mt-6 space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>连接状态</CardTitle>
                <CardDescription>
                  当前状态来自后端识别到的 API runtime，敏感配置只以布尔值展示。
                </CardDescription>
              </div>
              <Badge
                variant={ready ? "default" : configured ? "secondary" : "outline"}
                className={cn(!ready && configured && "bg-amber-500/10 text-amber-700")}
              >
                {ready ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertCircle className="h-3 w-3" />
                )}
                {ready ? "已就绪" : configured ? "待刷新" : "未配置"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-muted/20 px-4 py-2">
              <FieldRow label="运行环境" value={apiRuntime?.name ?? "未发现"} />
              <FieldRow label="状态" value={apiRuntime?.status ?? "—"} />
              <FieldRow label="Provider" value={apiRuntime?.provider ?? "openai"} />
              <FieldRow
                label="配置来源"
                value={metadata.config_source ?? "environment"}
              />
              <FieldRow
                label="API Key"
                value={metadata.api_key_configured ? "已配置" : "未配置"}
              />
              <FieldRow
                label="Base URL"
                value={metadata.base_url_configured ? "已配置" : "使用默认值"}
              />
              <FieldRow
                label="任务能力"
                value={
                  metadata.task_execution === "tool_loop"
                    ? "聊天 + 工具循环"
                    : metadata.task_execution === "chat_only"
                      ? "仅聊天任务"
                      : "—"
                }
              />
              <FieldRow
                label="工具 / Skills"
                value={metadata.supports_tools ? "支持内置文件工具" : "暂不支持"}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>中转站 / cc-switch</CardTitle>
            <CardDescription>
              支持 cc-switch、CodeAPI、TokenGo、9527code、OpenRouter 等 OpenAI 兼容入口。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              Origin 会优先读取 ORIGIN_MODEL_*。如果这些变量不存在，会兜底读取
              OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_API_BASE、OPENAI_API_BASE_URL、
              OPENAI_MODEL、OPENAI_MODEL_NAME、OPENAI_MODELS。cc-switch 请使用 Codex / OpenAI
              兼容配置，Base URL 通常需要带 /v1；Claude Code 的 ANTHROPIC_* 配置不会被当成
              Chat Completions API 使用。
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>工具能力</CardTitle>
            <CardDescription>
              大模型 API 负责决策，Origin 负责执行内置工具并把结果回传给模型。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Wrench className="h-4 w-4" />
                已开放只读本地文件工具
              </div>
              <p className="mt-2 text-muted-foreground">
                当前支持 list_directory、read_text_file、search_text。可通过
                ORIGIN_MODEL_TOOL_ROOTS 限定可读取和搜索的目录；暂不开放写文件、Shell、浏览器、
                MCP 或 Codex / Claude Code 原生 skills 执行。
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>环境变量配置</CardTitle>
                <CardDescription>
                  修改后重启服务端或桌面托管的后端进程，再回到这里刷新状态。
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void copySnippet()}>
                <Clipboard className="h-3.5 w-3.5" />
                复制
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <KeyRound className="h-3.5 w-3.5" />
                  必填
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {requiredEnv.map((name) => (
                    <Badge key={name} variant="outline" className="font-mono">
                      {name}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <ServerCog className="h-3.5 w-3.5" />
                  可选
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {optionalEnv.map((name) => (
                    <Badge key={name} variant="outline" className="font-mono">
                      {name}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed">
              <code>{envSnippet}</code>
            </pre>
            <p className="text-xs text-muted-foreground">
              页面不会保存 API Key。密钥只从后端进程环境变量读取，避免写入前端缓存、本地偏好或数据库。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>可用模型</CardTitle>
            <CardDescription>
              模型列表来自 ORIGIN_MODEL_NAME / ORIGIN_MODEL_NAMES，默认模型会用于新建智能体。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {models.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {models.map((model) => (
                  <Badge
                    key={model.id}
                    variant={model.id === defaultModel ? "default" : "outline"}
                    className="max-w-full"
                    title={model.id}
                  >
                    <span className="truncate">{model.label ?? model.id}</span>
                    {model.id === defaultModel && <span>默认</span>}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                暂未发现模型。配置 ORIGIN_MODEL_NAME 后重启后端即可生成 API runtime。
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
