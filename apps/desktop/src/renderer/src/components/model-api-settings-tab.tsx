import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  HelpCircle,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Settings2,
  Terminal,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  api,
  type ModelAPIConfigPayload,
  type ModelAPIConnectionTestResponse,
  type ModelAPILastTest,
} from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { runtimeKeys, runtimeListOptions } from "@multica/core/runtimes/queries";
import type { AgentRuntime } from "@multica/core/types";
import { AppLink } from "@multica/views/navigation";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@multica/ui/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@multica/ui/components/ui/alert";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@multica/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
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
const DEFAULT_TOOL_ROOTS = "";
const TOOL_ROOTS_PLACEHOLDER = "$HOME/OriginWorkbenchMount";

export const modelApiSettingsLayoutClasses = {
  root: "space-y-6",
  header: "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
  shellGrid: "grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]",
  providerGrid: "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(10rem,100%),1fr))]",
  codeBadge: "max-w-full min-w-0 whitespace-normal break-all text-left font-mono",
} as const;

export type SetupMode = "official" | "relay" | "ccSwitch" | "custom";
type PrimaryConnectionField = "apiKey" | "baseUrl" | "modelName";
type HelpTopic = "apiKey" | "baseUrl" | "modelName" | "advanced";

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
    eyebrow: "已有本机网关",
    description: "已经用 cc-switch 管理模型时选这个。",
    envFamily: "OPENAI_*",
    defaultBaseUrl: "https://your-cc-switch.example/v1",
    defaultRuntimeName: "cc-switch",
    requiredEnv: CC_SWITCH_REQUIRED_ENV,
    optionalEnv: CC_SWITCH_OPTIONAL_ENV,
  },
  {
    id: "relay",
    title: "OpenRouter / 中转站",
    eyebrow: "第三方网关",
    description: "适合 OpenRouter、CodeAPI、TokenGo 等 OpenAI 兼容入口。",
    envFamily: "ORIGIN_MODEL_*",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultRuntimeName: "OpenRouter / 中转站",
    requiredEnv: REQUIRED_ENV,
    optionalEnv: OPTIONAL_ENV,
  },
  {
    id: "official",
    title: "OpenAI 官方 API",
    eyebrow: "官方直连",
    description: "直接使用 OpenAI 官方 Chat Completions 兼容入口。",
    envFamily: "ORIGIN_MODEL_*",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultRuntimeName: "OpenAI API",
    requiredEnv: REQUIRED_ENV,
    optionalEnv: OPTIONAL_ENV,
  },
  {
    id: "custom",
    title: "自定义兼容服务",
    eyebrow: "OpenAI Compatible",
    description: "适合私有网关或企业模型代理。",
    envFamily: "ORIGIN_MODEL_*",
    defaultBaseUrl: "https://your-provider.example/v1",
    defaultRuntimeName: "外接模型 API",
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

function mergeDisplayModels(
  runtimeModelsList: RuntimeModel[],
  configuredModels: RuntimeModel[],
  discoveredModelIds: string[] | undefined,
  defaultModel: string | undefined,
) {
  const seen = new Set<string>();
  const merged: RuntimeModel[] = [];
  const add = (model: RuntimeModel) => {
    const id = model.id.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    merged.push({
      ...model,
      id,
      label: model.label ?? id,
      default: model.default === true || id === defaultModel,
    });
  };
  runtimeModelsList.forEach(add);
  configuredModels.forEach(add);
  discoveredModelIds?.forEach((id) => add({ id }));
  return merged;
}

function modeInfo(mode: SetupMode) {
  return SETUP_MODES.find((item) => item.id === mode) ?? SETUP_MODES[0];
}

export function modelApiProviderDefaults(mode: SetupMode) {
  const info = modeInfo(mode);
  return {
    baseUrl: info.defaultBaseUrl,
    runtimeName: info.defaultRuntimeName,
  };
}

export function getPrimaryConnectionFields(mode: SetupMode): PrimaryConnectionField[] {
  if (mode === "official") return ["apiKey", "modelName"];
  return ["apiKey", "baseUrl", "modelName"];
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

function maskApiKeyForDisplay(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}********${trimmed.slice(-4)}`;
}

export function buildGuidedSetupSnippets(form: GuidedSetupForm) {
  const info = modeInfo(form.mode);
  const modelName = form.modelName.trim() || MODEL_PLACEHOLDER;
  const modelList = form.modelList.trim() || form.modelName.trim() || MODEL_PLACEHOLDER;
  const toolRoots = form.toolRoots.trim() || TOOL_ROOTS_PLACEHOLDER;

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

export function buildGuidedSetupDisplaySnippets(form: GuidedSetupForm) {
  return buildGuidedSetupSnippets({
    ...form,
    apiKey: maskApiKeyForDisplay(form.apiKey),
  });
}

function modelApiConfigKey(wsId: string) {
  return ["model-api-config", wsId] as const;
}

export function buildModelApiConnectionPayload(form: GuidedSetupForm): ModelAPIConfigPayload {
  const toolRoots = form.toolRoots.trim();
  const payload: ModelAPIConfigPayload = {
    provider: "openai_compatible",
    api_key: form.apiKey.trim() || undefined,
    base_url: form.baseUrl.trim() || undefined,
    model_name: form.modelName.trim() || undefined,
    model_names: form.modelList.trim() || form.modelName.trim() || undefined,
    runtime_name: form.runtimeName.trim() || modeInfo(form.mode).defaultRuntimeName,
  };
  if (toolRoots) payload.tool_roots = toolRoots;
  return payload;
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
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-3 py-1.5">
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

function HelpIconButton({ topic, onOpen }: { topic: HelpTopic; onOpen: (topic: HelpTopic) => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground"
      onClick={() => onOpen(topic)}
    >
      <HelpCircle className="h-3.5 w-3.5" />
      <span className="sr-only">查看说明</span>
    </Button>
  );
}

function FormField({
  id,
  label,
  children,
  helpTopic,
  onHelp,
}: {
  id: string;
  label: string;
  children: ReactNode;
  helpTopic?: HelpTopic;
  onHelp: (topic: HelpTopic) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
        {helpTopic && <HelpIconButton topic={helpTopic} onOpen={onHelp} />}
      </div>
      {children}
    </div>
  );
}

function CopyBlock({
  title,
  description,
  value,
  displayValue,
  onCopy,
}: {
  title: string;
  description: string;
  value: string;
  displayValue?: string;
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
        <code>{displayValue ?? value}</code>
      </pre>
    </div>
  );
}

function ConnectionResult({ result }: { result: ModelAPIConnectionTestResponse | null }) {
  if (!result) return null;
  return (
    <Alert variant={result.ok ? "default" : "destructive"}>
      {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      <AlertTitle>{result.ok ? "连接可用" : "连接失败"}</AlertTitle>
      <AlertDescription>
        <span>{result.message}</span>
        {(result.latency_ms !== undefined || result.last_tested_at) && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {result.last_tested_at ? `检测时间 ${formatLastTestedAt(result.last_tested_at)}` : null}
            {result.last_tested_at && result.latency_ms !== undefined ? " · " : null}
            {result.latency_ms !== undefined ? `耗时 ${result.latency_ms}ms` : null}
          </span>
        )}
        {result.discovered_models && result.discovered_models.length > 0 && (
          <span className="mt-1 block text-xs text-muted-foreground">
            自动发现 {result.discovered_models.slice(0, 4).join(", ")}
            {result.discovered_models.length > 4 ? ` 等 ${result.discovered_models.length} 个模型` : ""}
          </span>
        )}
        {!result.ok && result.detail && (
          <span className="mt-1 block break-words font-mono text-xs">{result.detail}</span>
        )}
      </AlertDescription>
    </Alert>
  );
}

function formatLastTestedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function connectionResultFromLastTest(
  lastTest: ModelAPILastTest | undefined,
  discoveredModels?: string[],
): ModelAPIConnectionTestResponse | null {
  if (!lastTest) return null;
  return {
    ok: lastTest.ok,
    code: lastTest.code,
    message: lastTest.message,
    detail: lastTest.detail,
    last_tested_at: lastTest.last_tested_at,
    latency_ms: lastTest.latency_ms,
    discovered_models: discoveredModels,
  };
}

function connectionResultFromApiError(error: unknown): ModelAPIConnectionTestResponse | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (!body || typeof body !== "object") return null;
  const result = (body as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const record = result as Partial<ModelAPIConnectionTestResponse>;
  if (typeof record.ok !== "boolean" || typeof record.message !== "string") return null;
  return {
    ok: record.ok,
    code: typeof record.code === "string" ? record.code : undefined,
    message: record.message,
    detail: typeof record.detail === "string" ? record.detail : undefined,
    last_tested_at: typeof record.last_tested_at === "string" ? record.last_tested_at : undefined,
    latency_ms: typeof record.latency_ms === "number" ? record.latency_ms : undefined,
    discovered_models: Array.isArray(record.discovered_models)
      ? record.discovered_models.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

function HelpDialog({
  topic,
  onOpenChange,
}: {
  topic: HelpTopic | null;
  onOpenChange: (open: boolean) => void;
}) {
  const content = {
    apiKey: {
      title: "API Key",
      body: "从模型供应商后台创建。保存后只在服务端配置文件里使用，页面不会回显完整 Key；下次只改模型或 Base URL 时可以留空。",
    },
    baseUrl: {
      title: "Base URL",
      body: "中转站和私有网关通常需要填到 /v1。OpenAI 官方直连可以使用默认地址，所以主流程里不要求填写。",
    },
    modelName: {
      title: "模型 ID",
      body: "必须和供应商后台展示的可调用模型名一致，例如 gpt-4.1-mini 或 openrouter/auto。连接测试会用这个模型发起一次最小请求。",
    },
    advanced: {
      title: "高级信息",
      body: "模型列表、能力来源名称、允许读取的目录和环境变量命令都放在这里。普通接入只需要完成主流程里的三个字段。",
    },
  } satisfies Record<HelpTopic, { title: string; body: string }>;
  const item = topic ? content[topic] : null;

  return (
    <Dialog open={Boolean(topic)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item?.title}</DialogTitle>
          <DialogDescription>{item?.body}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export function ModelApiSettingsTab() {
  const wsId = useWorkspaceId();
  const workspacePaths = useWorkspacePaths();
  const queryClient = useQueryClient();
  const runtimesQuery = useQuery(runtimeListOptions(wsId));
  const configQuery = useQuery({
    queryKey: modelApiConfigKey(wsId),
    queryFn: () => api.getModelAPIConfig(),
    enabled: Boolean(wsId),
  });
  const [form, setForm] = useState<GuidedSetupForm>({
    mode: "ccSwitch",
    apiKey: "",
    baseUrl: modeInfo("ccSwitch").defaultBaseUrl,
    modelName: "gpt-4.1-mini",
    modelList: "",
    runtimeName: modeInfo("ccSwitch").defaultRuntimeName,
    toolRoots: DEFAULT_TOOL_ROOTS,
  });
  const [formTouched, setFormTouched] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ModelAPIConnectionTestResponse | null>(null);
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);

  useEffect(() => {
    const cfg = configQuery.data;
    if (!cfg || formTouched) return;
    setForm((current) => ({
      ...current,
      baseUrl: cfg.base_url || current.baseUrl,
      modelName: cfg.model_name || current.modelName,
      modelList: cfg.model_names || current.modelList,
      runtimeName: cfg.runtime_name || current.runtimeName,
      toolRoots: cfg.tool_roots ?? current.toolRoots,
    }));
  }, [configQuery.data, formTouched]);

  const apiRuntime = useMemo(
    () => runtimesQuery.data?.find(isModelApiRuntime) ?? null,
    [runtimesQuery.data],
  );
  const metadata = asMetadata(apiRuntime);
  const models = mergeDisplayModels(
    runtimeModels(metadata.models),
    configQuery.data?.models ?? [],
    configQuery.data?.discovered_models,
    configQuery.data?.model_name ?? metadata.default_model,
  );
  const savedConnectionResult = connectionResultFromLastTest(
    configQuery.data?.last_test,
    configQuery.data?.discovered_models,
  );
  const activeModeInfo = modeInfo(form.mode);
  const primaryFields = getPrimaryConnectionFields(form.mode);
  const requiresBaseUrl = primaryFields.includes("baseUrl");
  const configSource = configQuery.data?.config_source ?? metadata.config_source ?? "none";
  const savedSecretAvailable = Boolean(
    configQuery.data?.api_key_configured && !configSource.startsWith("environment"),
  );
  const hasApiKey = Boolean(form.apiKey.trim() || configQuery.data?.api_key_configured);
  const hasMinimumFields = Boolean(
    hasApiKey && form.modelName.trim() && (!requiresBaseUrl || form.baseUrl.trim()),
  );
  const canSave = Boolean(
    (form.apiKey.trim() || savedSecretAvailable) &&
      form.modelName.trim() &&
      (!requiresBaseUrl || form.baseUrl.trim()),
  );
  const configured = Boolean(configQuery.data?.api_key_configured || metadata.api_key_configured);
  const ready = Boolean(configQuery.data?.ready || (configured && apiRuntime?.status === "online"));
  const snippets = useMemo(() => buildGuidedSetupSnippets(form), [form]);
  const displaySnippets = useMemo(() => buildGuidedSetupDisplaySnippets(form), [form]);

  const updateForm = (patch: Partial<GuidedSetupForm>) => {
    setFormTouched(true);
    setConnectionResult(null);
    setForm((current) => ({ ...current, ...patch }));
  };

  const selectMode = (mode: SetupMode) => {
    const next = modeInfo(mode);
    setFormTouched(true);
    setConnectionResult(null);
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: runtimeKeys.list(wsId) }),
      queryClient.invalidateQueries({ queryKey: modelApiConfigKey(wsId) }),
    ]);
    toast.success("正在刷新大模型 API 状态");
  };

  const saveMutation = useMutation({
    mutationFn: () => api.saveModelAPIConfig(buildModelApiConnectionPayload(form)),
    onSuccess: async (data) => {
      queryClient.setQueryData(modelApiConfigKey(wsId), data);
      setConnectionResult(connectionResultFromLastTest(data.last_test, data.discovered_models));
      setFormTouched(false);
      await queryClient.invalidateQueries({ queryKey: runtimeKeys.list(wsId) });
      toast.success("大模型 API 已测试并启用");
    },
    onError: (error) => {
      const result = connectionResultFromApiError(error);
      if (result) setConnectionResult(result);
      toast.error(error instanceof Error ? error.message : "保存失败");
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api.testModelAPIConfig(buildModelApiConnectionPayload(form)),
    onSuccess: (result) => {
      setConnectionResult(result);
      if (result.ok) toast.success("连接测试通过");
      else toast.error(result.message);
    },
    onError: (error) => {
      const result = connectionResultFromApiError(error);
      if (result) setConnectionResult(result);
      toast.error(error instanceof Error ? error.message : "连接测试失败");
    },
  });

  const copyText = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div className={modelApiSettingsLayoutClasses.root}>
      <div className={modelApiSettingsLayoutClasses.header}>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">大模型 API</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            选择服务商，填连接信息，保存前会自动测试，成功后成为可选能力来源。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-fit shrink-0"
          onClick={() => void refresh()}
          disabled={runtimesQuery.isFetching || configQuery.isFetching}
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5",
              (runtimesQuery.isFetching || configQuery.isFetching) && "animate-spin",
            )}
          />
          刷新状态
        </Button>
      </div>

      {configQuery.data?.env_override && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>当前环境变量正在覆盖页面保存的配置</AlertTitle>
          <AlertDescription>
            页面仍可保存备用配置，但运行时会优先使用 ORIGIN_MODEL_* 或 OPENAI_*。要让页面配置接管，
            清空这些环境变量后重启后端。
          </AlertDescription>
        </Alert>
      )}

      <div className={modelApiSettingsLayoutClasses.shellGrid}>
        <Card className="min-w-0 border-primary/25">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>连接模型服务</CardTitle>
                <CardDescription>主流程只保留会影响连接成败的字段，点击保存时会先做连通性校验。</CardDescription>
              </div>
              <Badge variant={ready ? "default" : hasMinimumFields ? "secondary" : "outline"}>
                {ready ? "已启用" : hasMinimumFields ? "可测试" : "待填写"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className={modelApiSettingsLayoutClasses.providerGrid}>
              {SETUP_MODES.map((mode) => {
                const selected = mode.id === form.mode;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => selectMode(mode.id)}
                    className={cn(
                      "min-w-0 rounded-lg border p-4 text-left transition-colors hover:bg-muted/30",
                      selected && "border-primary bg-primary/5 shadow-sm",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold leading-snug">{mode.title}</p>
                        <p className="mt-1 break-words text-xs text-muted-foreground">{mode.eyebrow}</p>
                      </div>
                      {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                    </div>
                    <p className="mt-3 break-words text-xs leading-relaxed text-muted-foreground">
                      {mode.description}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <FormField
                id="model-api-key"
                label="API Key"
                helpTopic="apiKey"
                onHelp={setHelpTopic}
              >
                <Input
                  id="model-api-key"
                  type="password"
                  value={form.apiKey}
                  placeholder={configQuery.data?.api_key_configured ? "已保存，留空则继续使用" : "sk-..."}
                  onChange={(event) => updateForm({ apiKey: event.target.value })}
                />
              </FormField>
              {requiresBaseUrl && (
                <FormField
                  id="model-api-base-url"
                  label="Base URL"
                  helpTopic="baseUrl"
                  onHelp={setHelpTopic}
                >
                  <Input
                    id="model-api-base-url"
                    value={form.baseUrl}
                    placeholder={activeModeInfo.defaultBaseUrl}
                    onChange={(event) => updateForm({ baseUrl: event.target.value })}
                  />
                </FormField>
              )}
              <FormField
                id="model-api-model"
                label="模型 ID"
                helpTopic="modelName"
                onHelp={setHelpTopic}
              >
                <Input
                  id="model-api-model"
                  value={form.modelName}
                  placeholder={MODEL_PLACEHOLDER}
                  onChange={(event) => updateForm({ modelName: event.target.value })}
                />
              </FormField>
            </div>

            <ConnectionResult result={connectionResult} />

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={!hasMinimumFields || testMutation.isPending}
                onClick={() => testMutation.mutate()}
              >
                {testMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plug className="h-3.5 w-3.5" />
                )}
                测试连接
              </Button>
              <Button
                disabled={!canSave || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                测试并保存
              </Button>
            </div>

            <Accordion>
              <AccordionItem value="advanced">
                <AccordionTrigger className="px-0">
                  <span className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                    高级信息与手动配置
                    <HelpIconButton topic="advanced" onOpen={setHelpTopic} />
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    {!requiresBaseUrl && (
                      <FormField
                        id="model-api-official-base-url"
                        label="Base URL"
                        helpTopic="baseUrl"
                        onHelp={setHelpTopic}
                      >
                        <Input
                          id="model-api-official-base-url"
                          value={form.baseUrl}
                          placeholder={activeModeInfo.defaultBaseUrl}
                          onChange={(event) => updateForm({ baseUrl: event.target.value })}
                        />
                      </FormField>
                    )}
                    <FormField id="model-api-models" label="可选模型列表" onHelp={setHelpTopic}>
                      <Input
                        id="model-api-models"
                        value={form.modelList}
                        placeholder={`${form.modelName || "gpt-4.1-mini"},gpt-4.1`}
                        onChange={(event) => updateForm({ modelList: event.target.value })}
                      />
                    </FormField>
                    <FormField id="model-api-runtime-name" label="能力来源名称" onHelp={setHelpTopic}>
                      <Input
                        id="model-api-runtime-name"
                        value={form.runtimeName}
                        placeholder={activeModeInfo.defaultRuntimeName}
                        onChange={(event) => updateForm({ runtimeName: event.target.value })}
                      />
                    </FormField>
                    <FormField id="model-api-tool-roots" label="允许读取的目录" onHelp={setHelpTopic}>
                      <Input
                        id="model-api-tool-roots"
                        value={form.toolRoots}
                        placeholder={TOOL_ROOTS_PLACEHOLDER}
                        onChange={(event) => updateForm({ toolRoots: event.target.value })}
                      />
                    </FormField>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <CopyBlock
                      title="Mac App 环境变量"
                      description="只在你需要绕过页面保存、继续使用系统环境变量时复制。"
                      value={snippets.launchctl}
                      displayValue={displaySnippets.launchctl}
                      onCopy={() => void copyText(snippets.launchctl, "Mac App 配置命令已复制")}
                    />
                    <CopyBlock
                      title="终端 / daemon"
                      description="适合从终端手动启动后端或调试进程。"
                      value={snippets.shell}
                      displayValue={displaySnippets.shell}
                      onCopy={() => void copyText(snippets.shell, "终端配置片段已复制")}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>连接状态</CardTitle>
            <CardDescription>保存后会出现在智能体的能力来源里。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/15 px-4 py-3">
              <FieldRow label="状态" value={ready ? "已就绪" : configured ? "已保存，待确认" : "未配置"} />
              <FieldRow label="能力来源" value={apiRuntime?.name ?? configQuery.data?.runtime_name ?? "未创建"} />
              <FieldRow label="默认模型" value={configQuery.data?.model_name ?? metadata.default_model ?? "—"} mono />
              <FieldRow label="配置来源" value={configSource} mono />
              <FieldRow label="API Key" value={configured ? "已配置" : "未配置"} />
              <FieldRow
                label="最近检测"
                value={
                  savedConnectionResult
                    ? `${savedConnectionResult.ok ? "通过" : "失败"} · ${formatLastTestedAt(
                        savedConnectionResult.last_tested_at ?? "",
                      )}`
                    : "未检测"
                }
              />
              {savedConnectionResult?.latency_ms !== undefined && (
                <FieldRow label="响应耗时" value={`${savedConnectionResult.latency_ms}ms`} />
              )}
            </div>

            <div className="rounded-lg border bg-muted/15 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Wrench className="h-4 w-4" />
                当前开放工具
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {["list_directory", "read_text_file", "search_text"].map((name) => (
                  <Badge
                    key={name}
                    variant="outline"
                    className={modelApiSettingsLayoutClasses.codeBadge}
                  >
                    {name}
                  </Badge>
                ))}
              </div>
            </div>

            <Button render={<AppLink href={workspacePaths.agents()} />}>
              去智能体选择
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>已识别模型</CardTitle>
                <CardDescription>保存多个模型后，创建智能体时可选择。</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {models.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {models.map((model) => (
                  <Badge
                    key={model.id}
                    variant={model.default ? "default" : "outline"}
                    className="max-w-full"
                    title={model.id}
                  >
                    <span className="truncate">{model.label ?? model.id}</span>
                    {model.default && <span>默认</span>}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无模型，保存后会显示。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <Terminal className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>变量族</CardTitle>
                <CardDescription>仅给排障和迁移使用，主流程不需要记这些变量。</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border px-3 py-2">
              <p className="text-xs font-medium">必填变量</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeModeInfo.requiredEnv.map((name) => (
                  <Badge
                    key={name}
                    variant="outline"
                    className={modelApiSettingsLayoutClasses.codeBadge}
                  >
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <p className="text-xs font-medium">常用可选</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeModeInfo.optionalEnv.map((name) => (
                  <Badge
                    key={name}
                    variant="outline"
                    className={modelApiSettingsLayoutClasses.codeBadge}
                  >
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <HelpDialog topic={helpTopic} onOpenChange={(open) => !open && setHelpTopic(null)} />
    </div>
  );
}
