import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  KeyRound,
  ListChecks,
  Plug,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Terminal,
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

type SetupMode = "official" | "relay" | "ccSwitch";

const SETUP_MODES: Array<{
  id: SetupMode;
  title: string;
  eyebrow: string;
  description: string;
  envFamily: string;
}> = [
  {
    id: "ccSwitch",
    title: "cc-switch / Codex 兼容环境",
    eyebrow: "推荐给中转站切换",
    description: "沿用 cc-switch 写出的 OpenAI 兼容变量，Origin 自动识别为 API runtime。",
    envFamily: "OPENAI_* + ORIGIN_MODEL_TOOL_ROOTS",
  },
  {
    id: "relay",
    title: "中转站 / OpenRouter",
    eyebrow: "推荐给第三方网关",
    description: "用 Origin 专属变量接入任意 OpenAI Chat Completions 兼容 Base URL。",
    envFamily: "ORIGIN_MODEL_*",
  },
  {
    id: "official",
    title: "OpenAI 官方 API",
    eyebrow: "最小配置",
    description: "只需要 API Key 和模型名，Base URL 可以使用官方默认地址。",
    envFamily: "ORIGIN_MODEL_*",
  },
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

function modelList(defaultModel: string) {
  return defaultModel;
}

function buildShellSnippet(defaultModel: string, mode: SetupMode) {
  const models = modelList(defaultModel);
  if (mode === "ccSwitch") {
    return [
      "# 终端 / daemon 启动方式：使用 cc-switch 或 Codex 的 OpenAI 兼容变量",
      'export OPENAI_API_KEY="sk-..."',
      'export OPENAI_BASE_URL="https://your-relay.example/v1"',
      `export OPENAI_MODEL="${defaultModel}"`,
      `export OPENAI_MODELS="${models}"`,
      "",
      "# 可选：限制 API runtime 可读取和搜索的本地目录",
      'export ORIGIN_MODEL_TOOL_ROOTS="$HOME/OriginWorkbenchMount"',
      "",
      "# 重启 Origin 或重启守护进程后，回到本页点“刷新”",
    ].join("\n");
  }

  const runtimeName = mode === "official" ? "OpenAI API" : "cc-switch / 中转站";
  const baseURL =
    mode === "official" ? "https://api.openai.com/v1" : "https://your-relay.example/v1";
  return [
    "# 终端 / daemon 启动方式：Origin 专属变量优先级最高",
    'export ORIGIN_MODEL_PROVIDER="openai_compatible"',
    'export ORIGIN_MODEL_API_KEY="sk-..."',
    `export ORIGIN_MODEL_BASE_URL="${baseURL}"`,
    `export ORIGIN_MODEL_NAME="${defaultModel}"`,
    `export ORIGIN_MODEL_NAMES="${models}"`,
    `export ORIGIN_MODEL_RUNTIME_NAME="${runtimeName}"`,
    "",
    "# 可选：限制 API runtime 可读取和搜索的本地目录",
    'export ORIGIN_MODEL_TOOL_ROOTS="$HOME/OriginWorkbenchMount"',
    "",
    "# 重启 Origin 或重启守护进程后，回到本页点“刷新”",
  ].join("\n");
}

function buildLaunchctlSnippet(defaultModel: string, mode: SetupMode) {
  const models = modelList(defaultModel);
  if (mode === "ccSwitch") {
    return [
      "# Mac 图形 App：Finder / Dock 打开的 Origin 读取 launchd 环境",
      'launchctl setenv OPENAI_API_KEY "sk-..."',
      'launchctl setenv OPENAI_BASE_URL "https://your-relay.example/v1"',
      `launchctl setenv OPENAI_MODEL "${defaultModel}"`,
      `launchctl setenv OPENAI_MODELS "${models}"`,
      'launchctl setenv ORIGIN_MODEL_TOOL_ROOTS "$HOME/OriginWorkbenchMount"',
      "",
      'osascript -e \'quit app "Origin"\'',
      'open -a "Origin"',
    ].join("\n");
  }

  const runtimeName = mode === "official" ? "OpenAI API" : "cc-switch / 中转站";
  const baseURL =
    mode === "official" ? "https://api.openai.com/v1" : "https://your-relay.example/v1";
  return [
    "# Mac 图形 App：Finder / Dock 打开的 Origin 读取 launchd 环境",
    'launchctl setenv ORIGIN_MODEL_PROVIDER "openai_compatible"',
    'launchctl setenv ORIGIN_MODEL_API_KEY "sk-..."',
    `launchctl setenv ORIGIN_MODEL_BASE_URL "${baseURL}"`,
    `launchctl setenv ORIGIN_MODEL_NAME "${defaultModel}"`,
    `launchctl setenv ORIGIN_MODEL_NAMES "${models}"`,
    `launchctl setenv ORIGIN_MODEL_RUNTIME_NAME "${runtimeName}"`,
    'launchctl setenv ORIGIN_MODEL_TOOL_ROOTS "$HOME/OriginWorkbenchMount"',
    "",
    'osascript -e \'quit app "Origin"\'',
    'open -a "Origin"',
  ].join("\n");
}

function FieldRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] items-baseline gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn("min-w-0 truncate text-sm", mono && "font-mono text-xs")}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function StepItem({
  index,
  title,
  description,
}: {
  index: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border bg-muted/40 text-xs font-medium">
        {index}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function CopyBlock({
  title,
  description,
  value,
  onCopy,
}: {
  title: string;
  description: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/15">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Clipboard className="h-3.5 w-3.5" />
          复制
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto p-4 text-xs leading-relaxed">
        <code>{value}</code>
      </pre>
    </div>
  );
}

export function ModelApiSettingsTab() {
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const runtimesQuery = useQuery(runtimeListOptions(wsId));
  const [activeMode, setActiveMode] = useState<SetupMode>("ccSwitch");

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
  const shellSnippet = useMemo(
    () => buildShellSnippet(defaultModel, activeMode),
    [activeMode, defaultModel],
  );
  const launchctlSnippet = useMemo(
    () => buildLaunchctlSnippet(defaultModel, activeMode),
    [activeMode, defaultModel],
  );
  const activeModeInfo = SETUP_MODES.find((mode) => mode.id === activeMode) ?? SETUP_MODES[0];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: runtimeKeys.list(wsId) });
    toast.success("正在刷新大模型 API 状态");
  };

  const copyText = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">大模型 API</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            接入 OpenAI Chat Completions 兼容 API、中转站或 cc-switch。模型负责回复和决策，
            Origin 负责执行已开放的本地工具并回传结果。
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>连接状态</CardTitle>
                <CardDescription>
                  后端只回传识别结果和布尔状态，不会把 API Key 暴露给前端。
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
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border bg-muted/20 px-4 py-2">
                <FieldRow label="运行环境" value={apiRuntime?.name ?? "未发现"} />
                <FieldRow label="状态" value={apiRuntime?.status ?? "—"} />
                <FieldRow label="Provider" value={apiRuntime?.provider ?? "openai"} />
                <FieldRow
                  label="配置来源"
                  value={metadata.config_source ?? "environment"}
                  mono
                />
              </div>
              <div className="rounded-lg border bg-muted/20 px-4 py-2">
                <FieldRow
                  label="API Key"
                  value={metadata.api_key_configured ? "已配置" : "未配置"}
                />
                <FieldRow
                  label="Base URL"
                  value={metadata.base_url_configured ? "已配置" : "默认或未配置"}
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
                  label="本地工具"
                  value={metadata.supports_tools ? "只读文件工具" : "未开放"}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>配置路径</CardTitle>
            <CardDescription>按顺序做完，再刷新本页看状态。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <StepItem
              index={1}
              title="选择接入方式"
              description="cc-switch 走 OPENAI_*；专属配置走 ORIGIN_MODEL_*。两者同时存在时 ORIGIN_MODEL_* 优先。"
            />
            <StepItem
              index={2}
              title="写入环境变量"
              description="Dock 或 Finder 打开的 Mac App 用 launchctl；终端启动 daemon 可用 export。"
            />
            <StepItem
              index={3}
              title="重启并刷新"
              description="退出 Origin 后重新打开，让桌面 App 和后端守护进程读取新的环境。"
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Plug className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>接入方式</CardTitle>
              <CardDescription>
                选择后，下方命令会自动切换变量族和 Base URL 模板。
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-3">
            {SETUP_MODES.map((mode) => {
              const selected = mode.id === activeMode;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setActiveMode(mode.id)}
                  className={cn(
                    "rounded-lg border p-4 text-left transition-colors hover:bg-muted/30",
                    selected && "border-primary bg-primary/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{mode.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{mode.eyebrow}</p>
                    </div>
                    {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {mode.description}
                  </p>
                  <Badge variant="outline" className="mt-3 font-mono text-[11px]">
                    {mode.envFamily}
                  </Badge>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-lg border bg-muted/15 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4" />
              当前选择：{activeModeInfo.title}
            </div>
            <p className="mt-2 text-muted-foreground">
              cc-switch 或中转站的 Base URL 必须是 OpenAI Chat Completions 兼容入口，通常以
              <span className="font-mono text-xs"> /v1</span> 结尾；Claude Code 的
              <span className="font-mono text-xs"> ANTHROPIC_*</span> 变量不会被当作
              Chat Completions API 使用。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Terminal className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>复制配置</CardTitle>
              <CardDescription>
                替换 API Key、Base URL 和模型名后执行。页面不保存密钥。
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyBlock
            title="Mac mini 本地 App"
            description="适合从 Dock、Finder 或当前已安装 Origin.app 打开。"
            value={launchctlSnippet}
            onCopy={() => void copyText(launchctlSnippet, "Mac App 配置命令已复制")}
          />
          <CopyBlock
            title="终端 / daemon"
            description="适合从终端启动后端或调试运行。"
            value={shellSnippet}
            onCopy={() => void copyText(shellSnippet, "终端环境变量片段已复制")}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <Wrench className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>工具能力</CardTitle>
                <CardDescription>
                  API runtime 当前开放安全的只读文件工具。
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              {["list_directory", "read_text_file", "search_text"].map((name) => (
                <div key={name} className="rounded-lg border bg-muted/15 px-3 py-2">
                  <p className="truncate font-mono text-xs">{name}</p>
                </div>
              ))}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              通过 <span className="font-mono text-xs">ORIGIN_MODEL_TOOL_ROOTS</span>{" "}
              限定可访问目录。写文件、Shell、浏览器、MCP、Codex / Claude Code 原生 skills 仍需要完整本地
              Agent runtime。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <ListChecks className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>模型与变量</CardTitle>
                <CardDescription>
                  模型来自环境变量，默认模型用于新建智能体。
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
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
                暂未发现模型。配置模型名并重启后端后，这里会显示可选模型。
              </p>
            )}

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
                  常用可选
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
