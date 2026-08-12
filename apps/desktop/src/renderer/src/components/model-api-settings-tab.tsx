import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  api,
  type ModelAPIProvider,
  type ModelAPIProviderPayload,
  type ModelAPIConnectionTestResponse,
  type ModelAPILastTest,
} from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { runtimeKeys, runtimeListOptions } from "@multica/core/runtimes/queries";
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
import { Switch } from "@multica/ui/components/ui/switch";
import { cn } from "@multica/ui/lib/utils";

const MODEL_PLACEHOLDER = "模型 ID，例如 gpt-4.1-mini";
const TOOL_ROOTS_PLACEHOLDER = "$HOME/OriginWorkbenchMount";

export const modelApiSettingsLayoutClasses = {
  root: "space-y-6",
  header: "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
  shellGrid: "grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]",
  providerGrid: "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(10rem,100%),1fr))]",
  codeBadge: "max-w-full min-w-0 whitespace-normal break-all text-left font-mono",
} as const;

export type ProviderPresetId = "deepseek" | "custom";

export interface ProviderPreset {
  id: ProviderPresetId;
  title: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  defaultRuntimeName: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    title: "DeepSeek",
    description: "一键填入官方 OpenAI 兼容地址与模型。",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    defaultRuntimeName: "DeepSeek API",
  },
  {
    id: "custom",
    title: "自定义",
    description: "OpenAI 兼容的自定义网关或企业模型代理。",
    defaultBaseUrl: "https://your-provider.example/v1",
    defaultModel: "",
    defaultRuntimeName: "外接模型 API",
  },
];

function presetInfo(preset: ProviderPresetId): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === preset) ?? PROVIDER_PRESETS[0]!;
}

export interface ProviderForm {
  preset: ProviderPresetId;
  name: string;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  modelNames: string;
  runtimeName: string;
  toolRoots: string;
}

export function buildProviderPayload(
  form: ProviderForm,
  enabled = true,
): ModelAPIProviderPayload {
  const payload: ModelAPIProviderPayload = {
    preset: form.preset,
    name: form.name.trim() || undefined,
    enabled,
    api_key: form.apiKey.trim() || undefined,
    base_url: form.baseUrl.trim() || undefined,
    model_name: form.modelName.trim() || undefined,
    model_names: form.modelNames.trim() || form.modelName.trim() || undefined,
    runtime_name: form.runtimeName.trim() || undefined,
  };
  const toolRoots = form.toolRoots.trim();
  if (toolRoots) payload.tool_roots = toolRoots;
  return payload;
}

export function maskApiKeyForDisplay(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}********${trimmed.slice(-4)}`;
}

function providerQueryKey(wsId: string) {
  return ["model-api-providers", wsId] as const;
}

type HelpTopic = "apiKey" | "baseUrl" | "modelName" | "advanced";

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

function providerModels(
  provider: ModelAPIProvider,
): Array<{ id: string; label?: string; default?: boolean }> {
  const out: Array<{ id: string; label?: string; default?: boolean }> = [];
  const seen = new Set<string>();
  const add = (id: string, label?: string, isDefault?: boolean) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: label ?? id, default: isDefault === true });
  };
  (provider.models ?? []).forEach((m) => add(m.id, m.label, m.default));
  (provider.discovered_models ?? []).forEach((id) => add(id));
  return out;
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
      body: "中转站和私有网关通常需要填到 /v1。选择 DeepSeek 预设会填入官方地址。",
    },
    modelName: {
      title: "模型 ID",
      body: "必须和供应商后台展示的可调用模型名一致。连接测试会用这个模型发起一次最小请求。",
    },
    advanced: {
      title: "高级信息",
      body: "可选模型列表、能力来源名称、允许读取的目录都放在这里。普通接入只需要完成预设、API Key 和模型 ID。",
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

function Field({
  id,
  label,
  helpTopic,
  onHelp,
  children,
}: {
  id: string;
  label: string;
  helpTopic?: HelpTopic;
  onHelp: (topic: HelpTopic) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
        {helpTopic && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => onHelp(helpTopic)}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span className="sr-only">查看说明</span>
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

function ProviderCard({
  provider,
  testing,
  testResult,
  onToggle,
  onTest,
  onEdit,
  onDelete,
}: {
  provider: ModelAPIProvider;
  testing: boolean;
  testResult: ModelAPIConnectionTestResponse | null;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const models = providerModels(provider);
  const readonly = provider.readonly;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="truncate">{provider.name}</CardTitle>
              <Badge variant="outline">{provider.provider}</Badge>
              {readonly && <Badge variant="secondary">环境变量</Badge>}
            </div>
            <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    provider.status === "online" ? "bg-success" : "bg-muted-foreground/40",
                  )}
                />
                {provider.status === "online" ? "在线" : "离线"}
              </span>
              {provider.base_url && <span className="truncate font-mono text-xs">{provider.base_url}</span>}
              {readonly && provider.config_source && <span>来源 {provider.config_source}</span>}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">启用</span>
            <Switch
              checked={provider.enabled}
              disabled={readonly}
              onCheckedChange={onToggle}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {models.length > 0 ? (
            models.map((m) => (
              <Badge
                key={m.id}
                variant={m.default ? "default" : "outline"}
                className="max-w-full"
                title={m.id}
              >
                <span className="truncate">{m.label ?? m.id}</span>
                {m.default && <span className="ml-1">默认</span>}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">暂无已发现模型</span>
          )}
        </div>

        {readonly && (
          <p className="text-xs text-muted-foreground">
            该 Provider 由环境变量（ORIGIN_MODEL_* / OPENAI_*）提供，只读。清空环境变量并重启后端后即可在页面管理。
          </p>
        )}

        <ConnectionResult result={testResult} />

        {!readonly && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plug className="h-3.5 w-3.5" />
              )}
              测试连接
            </Button>
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderFormBody({
  provider,
  onClose,
}: {
  provider: ModelAPIProvider | null;
  onClose: () => void;
}) {
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const isEdit = provider !== null;

  const [preset, setPreset] = useState<ProviderPresetId>(
    provider ? (provider.preset === "deepseek" ? "deepseek" : "custom") : "deepseek",
  );
  const [name, setName] = useState(provider?.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    provider?.base_url ?? (isEdit ? "" : presetInfo("deepseek").defaultBaseUrl),
  );
  const [modelName, setModelName] = useState(
    provider?.model_name ?? (isEdit ? "" : presetInfo("deepseek").defaultModel),
  );
  const [modelNames, setModelNames] = useState(provider?.model_names ?? "");
  const [runtimeName, setRuntimeName] = useState(
    provider?.runtime_name ?? (isEdit ? "" : presetInfo("deepseek").defaultRuntimeName),
  );
  const [toolRoots, setToolRoots] = useState(provider?.tool_roots ?? "");
  const [testResult, setTestResult] = useState<ModelAPIConnectionTestResponse | null>(null);
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);

  const form: ProviderForm = {
    preset,
    name,
    apiKey,
    baseUrl,
    modelName,
    modelNames,
    runtimeName,
    toolRoots,
  };

  const hasMinimumFields = Boolean(
    (apiKey.trim() || provider?.api_key_configured) && modelName.trim(),
  );

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: providerQueryKey(wsId) }),
      queryClient.invalidateQueries({ queryKey: runtimeKeys.list(wsId) }),
    ]);
  };

  const selectPreset = (next: ProviderPresetId) => {
    setPreset(next);
    const info = presetInfo(next);
    setBaseUrl(info.defaultBaseUrl);
    setModelName(info.defaultModel);
    setRuntimeName(info.defaultRuntimeName);
  };

  const testMutation = useMutation({
    mutationFn: () => api.testModelAPIProvider(provider!.id),
    onSuccess: (result) => {
      setTestResult(result);
      if (result.ok) toast.success("连接测试通过");
      else toast.error(result.message);
    },
    onError: (error) => {
      const result = connectionResultFromApiError(error);
      if (result) setTestResult(result);
      toast.error(error instanceof Error ? error.message : "连接测试失败");
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = buildProviderPayload(form, provider?.enabled ?? true);
      return provider
        ? api.updateModelAPIProvider(provider.id, payload)
        : api.createModelAPIProvider(payload);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(provider ? "Provider 已更新" : "Provider 已测试并保存");
      onClose();
    },
    onError: (error) => {
      const result = connectionResultFromApiError(error);
      if (result) setTestResult(result);
      toast.error(error instanceof Error ? error.message : "保存失败");
    },
  });

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">预设</Label>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDER_PRESETS.map((p) => {
            const selected = p.id === preset;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPreset(p.id)}
                className={cn(
                  "min-w-0 rounded-lg border p-3 text-left transition-colors hover:bg-muted/30",
                  selected && "border-primary bg-primary/5 shadow-sm",
                )}
              >
                <p className="text-sm font-semibold">{p.title}</p>
                <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                  {p.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <Field id="provider-api-key" label="API Key" helpTopic="apiKey" onHelp={setHelpTopic}>
        <Input
          id="provider-api-key"
          type="password"
          value={apiKey}
          placeholder={provider?.api_key_configured ? "已保存，留空则继续使用" : "sk-..."}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="provider-name" label="名称" onHelp={setHelpTopic}>
          <Input
            id="provider-name"
            value={name}
            placeholder="本地模型"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field id="provider-base-url" label="Base URL" helpTopic="baseUrl" onHelp={setHelpTopic}>
          <Input
            id="provider-base-url"
            value={baseUrl}
            placeholder={presetInfo(preset).defaultBaseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </Field>
        <Field id="provider-model" label="模型 ID" helpTopic="modelName" onHelp={setHelpTopic}>
          <Input
            id="provider-model"
            value={modelName}
            placeholder={MODEL_PLACEHOLDER}
            onChange={(event) => setModelName(event.target.value)}
          />
        </Field>
        <Field id="provider-models" label="可选模型列表" helpTopic="advanced" onHelp={setHelpTopic}>
          <Input
            id="provider-models"
            value={modelNames}
            placeholder={`${modelName || "gpt-4.1-mini"},gpt-4.1`}
            onChange={(event) => setModelNames(event.target.value)}
          />
        </Field>
        <Field id="provider-runtime-name" label="能力来源名称" helpTopic="advanced" onHelp={setHelpTopic}>
          <Input
            id="provider-runtime-name"
            value={runtimeName}
            placeholder={presetInfo(preset).defaultRuntimeName}
            onChange={(event) => setRuntimeName(event.target.value)}
          />
        </Field>
        <Field id="provider-tool-roots" label="允许读取的目录" helpTopic="advanced" onHelp={setHelpTopic}>
          <Input
            id="provider-tool-roots"
            value={toolRoots}
            placeholder={TOOL_ROOTS_PLACEHOLDER}
            onChange={(event) => setToolRoots(event.target.value)}
          />
        </Field>
      </div>

      <ConnectionResult result={testResult} />

      <div className="flex items-center justify-end gap-2">
        {isEdit && (
          <Button
            type="button"
            variant="outline"
            disabled={testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plug className="h-3.5 w-3.5" />
            )}
            测试连接
          </Button>
        )}
        <Button
          type="button"
          disabled={!hasMinimumFields || saveMutation.isPending}
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

      <HelpDialog topic={helpTopic} onOpenChange={(open) => !open && setHelpTopic(null)} />
    </div>
  );
}

function ProviderFormDialog({
  open,
  provider,
  onClose,
}: {
  open: boolean;
  provider: ModelAPIProvider | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{provider ? "编辑 Provider" : "新增 Provider"}</DialogTitle>
          <DialogDescription>
            {provider
              ? "修改连接信息；API Key 留空会沿用已保存的值。"
              : "选择预设并填写连接信息，保存前会先做连通性校验。"}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ProviderFormBody
            key={provider?.id ?? "new"}
            provider={provider}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ModelApiSettingsTab() {
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const runtimesQuery = useQuery(runtimeListOptions(wsId));
  const providersQuery = useQuery({
    queryKey: providerQueryKey(wsId),
    queryFn: () => api.listModelAPIProviders(),
    enabled: Boolean(wsId),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ModelAPIProvider | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ModelAPIProvider | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, ModelAPIConnectionTestResponse>
  >({});

  const providers = providersQuery.data ?? [];

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: providerQueryKey(wsId) }),
      queryClient.invalidateQueries({ queryKey: runtimeKeys.list(wsId) }),
    ]);
  };

  const refresh = async () => {
    await invalidate();
    toast.success("正在刷新大模型 API 状态");
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patchModelAPIProvider(id, { enabled }),
    onSuccess: async () => {
      await invalidate();
      toast.success("已更新启用状态");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "更新失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteModelAPIProvider(id),
    onSuccess: async () => {
      setConfirmDelete(null);
      await invalidate();
      toast.success("Provider 已删除");
    },
    onError: (error) => {
      setDeleteError(error instanceof Error ? error.message : "删除失败");
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => api.testModelAPIProvider(id),
    onMutate: (id) => setTestingId(id),
    onSuccess: (result, id) => {
      setTestResults((current) => ({ ...current, [id]: result }));
      if (result.ok) toast.success("连接测试通过");
      else toast.error(result.message);
    },
    onError: (error, id) => {
      const result = connectionResultFromApiError(error);
      if (result) setTestResults((current) => ({ ...current, [id]: result }));
      toast.error(error instanceof Error ? error.message : "连接测试失败");
    },
    onSettled: () => setTestingId(null),
  });

  const openDelete = (provider: ModelAPIProvider) => {
    setDeleteError(null);
    setConfirmDelete(provider);
  };

  return (
    <div className={modelApiSettingsLayoutClasses.root}>
      <div className={modelApiSettingsLayoutClasses.header}>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">大模型 API</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            管理多个模型 Provider，每个可独立启用、测试与删除；启用后会成为智能体可选的能力来源。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void refresh()}
            disabled={providersQuery.isFetching || runtimesQuery.isFetching}
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                (providersQuery.isFetching || runtimesQuery.isFetching) && "animate-spin",
              )}
            />
            刷新状态
          </Button>
          <Button size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            新增 Provider
          </Button>
        </div>
      </div>

      {providersQuery.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载…
        </div>
      ) : providers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            还没有配置任何模型 Provider。点击右上角「新增 Provider」开始。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              testing={testingId === provider.id}
              testResult={
                testResults[provider.id] ??
                connectionResultFromLastTest(provider.last_test, provider.discovered_models)
              }
              onToggle={(enabled) => toggleMutation.mutate({ id: provider.id, enabled })}
              onTest={() => testMutation.mutate(provider.id)}
              onEdit={() => setEditingProvider(provider)}
              onDelete={() => openDelete(provider)}
            />
          ))}
        </div>
      )}

      <ProviderFormDialog
        open={createOpen}
        provider={null}
        onClose={() => setCreateOpen(false)}
      />
      <ProviderFormDialog
        open={editingProvider !== null}
        provider={editingProvider}
        onClose={() => setEditingProvider(null)}
      />

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除 Provider</DialogTitle>
            <DialogDescription>
              确定要删除「{confirmDelete?.name}」吗？该 Provider 正在被智能体使用时无法删除。
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>删除失败</AlertTitle>
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={deleteMutation.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirmDelete) deleteMutation.mutate(confirmDelete.id);
              }}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
