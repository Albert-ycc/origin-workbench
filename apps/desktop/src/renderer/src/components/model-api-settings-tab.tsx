import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
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
import { useWorkspacePaths } from "@multica/core/paths";
import { runtimeKeys, runtimeListOptions } from "@multica/core/runtimes/queries";
import type { AgentRuntime } from "@multica/core/types";
import { AppLink } from "@multica/views/navigation";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@multica/ui/components/ui/card";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
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
const CC_SWITCH_REQUIRED_ENV = ["OPENAI_API_KEY", "OPENAI_MODEL"];
const CC_SWITCH_OPTIONAL_ENV = [
  "OPENAI_BASE_URL",
  "OPENAI_MODELS",
  "ORIGIN_MODEL_TOOL_ROOTS",
];

const API_KEY_PLACEHOLDER = "在这里粘贴 API Key";
const MODEL_PLACEHOLDER = "模型 ID，例如 gpt-4.1-mini";
const DEFAULT_TOOL_ROOTS = "$HOME/OriginWorkbenchMount";

export type SetupMode = "official" | "relay" | "ccSwitch";

export interface GuidedSetupForm {
  mode: SetupMode;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  modelList: string;
  runtimeName: string;
  toolRoots: string;
}

const SETUP_MODES: Array<{
  id: SetupMode;
  title: string;
  eyebrow: string;
  description: string;
  envFamily: string;
  defaultBaseUrl: string;
  defaultRuntimeName: string;
  requiredEnv: string[];
  optionalEnv: string[];
}> = [
  {
    id: "ccSwitch",
    title: "cc-switch / Codex 兼容环境",
    eyebrow: "推荐",
    description: "已经用 cc-switch 管理模型时选这个。Origin 直接读取 OPENAI_* 变量。",
    envFamily: "OPENAI_*",
    defaultBaseUrl: "https://your-cc-switch.example/v1",
    defaultRuntimeName: "cc-switch",
    requiredEnv: CC_SWITCH_REQUIRED_ENV,
    optionalEnv: CC_SWITCH_OPTIONAL_ENV,
  },
  {
    id: "relay",
    title: "中转站 / OpenRouter",
    eyebrow: "第三方网关",
    description: "适合 CodeAPI、TokenGo、9527code、OpenRouter 等 OpenAI 兼容入口。",
    envFamily: "ORIGIN_MODEL_*",
    defaultBaseUrl: "https://your-relay.example/v1",
    defaultRuntimeName: "cc-switch / 中转站",
    requiredEnv: REQUIRED_ENV,
    optionalEnv: OPTIONAL_ENV,
  },
  {
    id: "official",
    title: "OpenAI 官方 API",
    eyebrow: "官方直连",
    description: "适合直接使用 OpenAI 官方 Chat Completions 兼容入口。",
    envFamily: "ORIGIN_MODEL_*",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultRuntimeName: "OpenAI API",
    requiredEnv: REQUIRED_ENV,
    optionalEnv: OPTIONAL_ENV,
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

function modeInfo(mode: SetupMode) {
  return SETUP_MODES.find((item) => item.id === mode) ?? SETUP_MODES[0];
}

function isDefaultModeValue(value: string, key: "defaultBaseUrl" | "defaultRuntimeName") {
  return SETUP_MODES.some((item) => item[key] === value);
}

function quoteShellValue(value: string, options: { allowVariables?: boolean } = {}) {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/`/g, "\\`")
    .replace(/\$/g, options.allowVariables ? "$" : "\\$");
  return `"${escaped}"`;
}

function commandValue(
  value: string,
  placeholder: string,
  options: { allowVariables?: boolean } = {},
) {
  const trimmed = value.trim();
  return quoteShellValue(trimmed.length > 0 ? trimmed : placeholder, options);
}

export function buildGuidedSetupSnippets(form: GuidedSetupForm) {
  const info = modeInfo(form.mode);
  const modelName = form.modelName.trim() || MODEL_PLACEHOLDER;
  const modelList = form.modelList.trim() || form.modelName.trim() || MODEL_PLACEHOLDER;
  const toolRoots = form.toolRoots.trim() || DEFAULT_TOOL_ROOTS;

  if (form.mode === "ccSwitch") {
    const launchctl = [
      "# 1. 把下面三个值换成你的 cc-switch / 中转站配置",
      `launchctl setenv OPENAI_API_KEY ${commandValue(form.apiKey, API_KEY_PLACEHOLDER)}`,
      `launchctl setenv OPENAI_BASE_URL ${commandValue(form.baseUrl, info.defaultBaseUrl)}`,
      `launchctl setenv OPENAI_MODEL ${quoteShellValue(modelName)}`,
      `launchctl setenv OPENAI_MODELS ${quoteShellValue(modelList)}`,
      "",
      "# 2. 限制 API runtime 只能读取和搜索这个目录",
      `launchctl setenv ORIGIN_MODEL_TOOL_ROOTS ${quoteShellValue(toolRoots, {
        allowVariables: true,
      })}`,
      "",
      "# 3. 重启 Origin，让本地 App 读取新配置",
      'osascript -e \'quit app "Origin"\'',
      'open -a "Origin"',
    ].join("\n");

    const shell = [
      "# 终端 / daemon 启动方式",
      `export OPENAI_API_KEY=${commandValue(form.apiKey, API_KEY_PLACEHOLDER)}`,
      `export OPENAI_BASE_URL=${commandValue(form.baseUrl, info.defaultBaseUrl)}`,
      `export OPENAI_MODEL=${quoteShellValue(modelName)}`,
      `export OPENAI_MODELS=${quoteShellValue(modelList)}`,
      `export ORIGIN_MODEL_TOOL_ROOTS=${quoteShellValue(toolRoots, { allowVariables: true })}`,
    ].join("\n");

    return { launchctl, shell };
  }

  const runtimeName = form.runtimeName.trim() || info.defaultRuntimeName;
  const launchctl = [
    "# 1. 把下面三个值换成你的 API 服务配置",
    'launchctl setenv ORIGIN_MODEL_PROVIDER "openai_compatible"',
    `launchctl setenv ORIGIN_MODEL_API_KEY ${commandValue(form.apiKey, API_KEY_PLACEHOLDER)}`,
    `launchctl setenv ORIGIN_MODEL_BASE_URL ${commandValue(form.baseUrl, info.defaultBaseUrl)}`,
    `launchctl setenv ORIGIN_MODEL_NAME ${quoteShellValue(modelName)}`,
    `launchctl setenv ORIGIN_MODEL_NAMES ${quoteShellValue(modelList)}`,
    `launchctl setenv ORIGIN_MODEL_RUNTIME_NAME ${quoteShellValue(runtimeName)}`,
    "",
    "# 2. 限制 API runtime 只能读取和搜索这个目录",
    `launchctl setenv ORIGIN_MODEL_TOOL_ROOTS ${quoteShellValue(toolRoots, {
      allowVariables: true,
    })}`,
    "",
    "# 3. 重启 Origin，让本地 App 读取新配置",
    'osascript -e \'quit app "Origin"\'',
    'open -a "Origin"',
  ].join("\n");

  const shell = [
    "# 终端 / daemon 启动方式",
    'export ORIGIN_MODEL_PROVIDER="openai_compatible"',
    `export ORIGIN_MODEL_API_KEY=${commandValue(form.apiKey, API_KEY_PLACEHOLDER)}`,
    `export ORIGIN_MODEL_BASE_URL=${commandValue(form.baseUrl, info.defaultBaseUrl)}`,
    `export ORIGIN_MODEL_NAME=${quoteShellValue(modelName)}`,
    `export ORIGIN_MODEL_NAMES=${quoteShellValue(modelList)}`,
    `export ORIGIN_MODEL_RUNTIME_NAME=${quoteShellValue(runtimeName)}`,
    `export ORIGIN_MODEL_TOOL_ROOTS=${quoteShellValue(toolRoots, { allowVariables: true })}`,
  ].join("\n");

  return { launchctl, shell };
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
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-3 py-1.5">
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

function SetupStep({
  index,
  title,
  description,
  active,
  complete,
}: {
  index: number;
  title: string;
  description: string;
  active?: boolean;
  complete?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
          complete
            ? "border-primary bg-primary text-primary-foreground"
            : active
              ? "border-primary/60 bg-primary/10 text-primary"
              : "bg-muted/40",
        )}
      >
        {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : index}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function FormField({
  id,
  label,
  helper,
  children,
}: {
  id: string;
  label: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {helper && <p className="text-xs leading-relaxed text-muted-foreground">{helper}</p>}
    </div>
  );
}

function CopyBlock({
  title,
  description,
  value,
  primary,
  onCopy,
}: {
  title: string;
  description: string;
  value: string;
  primary?: boolean;
  onCopy: () => void;
}) {
  return (
    <div className={cn("rounded-lg border", primary ? "bg-background" : "bg-muted/15")}>
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button variant={primary ? "default" : "outline"} size="sm" onClick={onCopy}>
          <Clipboard className="h-3.5 w-3.5" />
          复制
        </Button>
      </div>
      <pre className="max-h-72 overflow-auto p-4 text-xs leading-relaxed">
        <code>{value}</code>
      </pre>
    </div>
  );
}

export function ModelApiSettingsTab() {
  const wsId = useWorkspaceId();
  const workspacePaths = useWorkspacePaths();
  const queryClient = useQueryClient();
  const runtimesQuery = useQuery(runtimeListOptions(wsId));
  const [form, setForm] = useState<GuidedSetupForm>({
    mode: "ccSwitch",
    apiKey: "",
    baseUrl: modeInfo("ccSwitch").defaultBaseUrl,
    modelName: "gpt-4.1-mini",
    modelList: "",
    runtimeName: modeInfo("ccSwitch").defaultRuntimeName,
    toolRoots: DEFAULT_TOOL_ROOTS,
  });

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
    form.modelName;
  const activeModeInfo = modeInfo(form.mode);
  const requiredEnv = activeModeInfo.requiredEnv;
  const optionalEnv = activeModeInfo.optionalEnv;
  const configured = Boolean(apiRuntime && metadata.api_key_configured);
  const ready = Boolean(configured && apiRuntime?.status === "online" && models.length > 0);
  const snippets = useMemo(() => buildGuidedSetupSnippets(form), [form]);
  const hasMinimumFields = Boolean(
    form.apiKey.trim() && form.baseUrl.trim() && form.modelName.trim(),
  );

  const updateForm = (patch: Partial<GuidedSetupForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const selectMode = (mode: SetupMode) => {
    const next = modeInfo(mode);
    setForm((current) => ({
      ...current,
      mode,
      baseUrl:
        current.baseUrl.trim().length === 0 || isDefaultModeValue(current.baseUrl, "defaultBaseUrl")
          ? next.defaultBaseUrl
          : current.baseUrl,
      runtimeName:
        current.runtimeName.trim().length === 0 ||
        isDefaultModeValue(current.runtimeName, "defaultRuntimeName")
          ? next.defaultRuntimeName
          : current.runtimeName,
    }));
  };

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
            按下面三步配置外接模型。你只需要准备 API Key、Base URL 和模型 ID，Origin 会把它识别成一个可选的智能体能力来源。
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
          刷新状态
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-primary/25">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>配置向导</CardTitle>
                <CardDescription>
                  输入不会保存到页面里，只用于生成你要执行的本机命令。
                </CardDescription>
              </div>
              <Badge variant={hasMinimumFields ? "secondary" : "outline"}>
                {hasMinimumFields ? "可复制命令" : "待填写"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 lg:grid-cols-3">
              {SETUP_MODES.map((mode) => {
                const selected = mode.id === form.mode;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => selectMode(mode.id)}
                    className={cn(
                      "rounded-lg border p-4 text-left transition-colors hover:bg-muted/30",
                      selected && "border-primary bg-primary/5 shadow-sm",
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

            <div className="grid gap-4 lg:grid-cols-2">
              <FormField
                id="model-api-key"
                label="API Key"
                helper="只在当前页面内生成命令，不会写入数据库。"
              >
                <Input
                  id="model-api-key"
                  type="password"
                  value={form.apiKey}
                  placeholder="sk-..."
                  onChange={(event) => updateForm({ apiKey: event.target.value })}
                />
              </FormField>
              <FormField
                id="model-api-base-url"
                label="Base URL"
                helper="cc-switch 和中转站一般需要带 /v1。"
              >
                <Input
                  id="model-api-base-url"
                  value={form.baseUrl}
                  placeholder={activeModeInfo.defaultBaseUrl}
                  onChange={(event) => updateForm({ baseUrl: event.target.value })}
                />
              </FormField>
              <FormField
                id="model-api-model"
                label="模型 ID"
                helper="要和供应商后台展示的模型名完全一致。"
              >
                <Input
                  id="model-api-model"
                  value={form.modelName}
                  placeholder={defaultModel}
                  onChange={(event) => updateForm({ modelName: event.target.value })}
                />
              </FormField>
              <FormField
                id="model-api-models"
                label="可选模型列表"
                helper="多个模型用英文逗号分隔；不填时只使用上面的模型。"
              >
                <Input
                  id="model-api-models"
                  value={form.modelList}
                  placeholder={`${form.modelName || defaultModel},gpt-4.1`}
                  onChange={(event) => updateForm({ modelList: event.target.value })}
                />
              </FormField>
              {form.mode !== "ccSwitch" && (
                <FormField
                  id="model-api-runtime-name"
                  label="能力来源名称"
                  helper="创建智能体时会看到这个名字。"
                >
                  <Input
                    id="model-api-runtime-name"
                    value={form.runtimeName}
                    placeholder={activeModeInfo.defaultRuntimeName}
                    onChange={(event) => updateForm({ runtimeName: event.target.value })}
                  />
                </FormField>
              )}
              <FormField
                id="model-api-tool-roots"
                label="允许读取的目录"
                helper="API 模型只能读取和搜索这里面的本地文件。"
              >
                <Input
                  id="model-api-tool-roots"
                  value={form.toolRoots}
                  placeholder={DEFAULT_TOOL_ROOTS}
                  onChange={(event) => updateForm({ toolRoots: event.target.value })}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>现在做到哪一步</CardTitle>
            <CardDescription>按顺序完成，最后去智能体里选择它。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SetupStep
              index={1}
              title="选入口并填信息"
              description="API Key、Base URL、模型 ID 填完即可生成命令。"
              active={!hasMinimumFields}
              complete={hasMinimumFields}
            />
            <SetupStep
              index={2}
              title="复制命令到终端执行"
              description="本机点击打开的 Origin.app 使用 Mac App 命令。"
              active={hasMinimumFields && !ready}
              complete={ready}
            />
            <SetupStep
              index={3}
              title="创建或编辑智能体"
              description="在能力来源里选大模型 API，再选择模型。"
              active={ready}
              complete={false}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Terminal className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>复制并执行</CardTitle>
              <CardDescription>
                先复制第一段。第二段只给从终端手动启动 daemon 的场景使用。
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyBlock
            title="Mac mini 本地 App"
            description="适合从 Dock、Finder 或 /Users/albert/Applications/Origin.app 打开的 Origin。"
            value={snippets.launchctl}
            primary
            onCopy={() => void copyText(snippets.launchctl, "Mac App 配置命令已复制")}
          />
          <CopyBlock
            title="终端 / daemon"
            description="只在你从终端启动 Origin 后端或调试进程时使用。"
            value={snippets.shell}
            onCopy={() => void copyText(snippets.shell, "终端配置片段已复制")}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/15 px-4 py-3">
            <div className="text-sm">
              <p className="font-medium">执行完命令后回到这里刷新。</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                如果仍显示未配置，通常是 key、模型名、Base URL 或 App 重启没有生效。
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
              我已执行，刷新
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
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
                <FieldRow label="能力来源" value={apiRuntime?.name ?? "未发现"} />
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

        <Card className={cn(ready && "border-primary/30")}>
          <CardHeader>
            <div className="flex items-start gap-3">
              <Plug className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>配置成功后怎么用</CardTitle>
                <CardDescription>外接 API 是一种能力来源，需要绑定到智能体。</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 rounded-lg border bg-muted/15 px-4 py-3 text-sm">
              <p>
                进入 <span className="font-medium">智能体</span>，新建或编辑一个智能体。
              </p>
              <p>
                在 <span className="font-medium">能力来源</span> 里选择{" "}
                <span className="font-medium">{apiRuntime?.name ?? activeModeInfo.defaultRuntimeName}</span>
                ，再选择或输入模型 ID。
              </p>
            </div>
            <Button render={<AppLink href={workspacePaths.agents()} />}>
              去智能体
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <Wrench className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>当前开放的工具</CardTitle>
                <CardDescription>外接模型可以让 Origin 代它执行这些安全工具。</CardDescription>
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
              写文件、Shell、浏览器、MCP、Codex / Claude Code 原生 skills 仍需要完整本地
              Agent runtime；这部分后续要继续补齐能力层。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <ListChecks className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>模型与变量</CardTitle>
                <CardDescription>这里展示 Origin 当前识别到的模型和变量族。</CardDescription>
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
                暂未发现模型。配置模型名并重启 Origin 后，这里会显示可选模型。
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

            <div className="rounded-lg border bg-muted/15 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4" />
                {activeModeInfo.title}
              </div>
              <p className="mt-2 text-muted-foreground">
                cc-switch 使用 OPENAI_*；专属配置使用 ORIGIN_MODEL_*。两者同时存在时，
                ORIGIN_MODEL_* 优先。
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
