"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Cloud,
  FileText,
  KeyRound,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  Upload,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  Agent,
  AgentVisibility,
  CreateAgentRequest,
  MemberWithUser,
  RuntimeDevice,
} from "@multica/core/types";
import { api } from "@multica/core/api";
import { AGENT_DESCRIPTION_MAX_LENGTH } from "@multica/core/agents";
import { useWorkspaceId } from "@multica/core/hooks";
import { useFileUpload } from "@multica/core/hooks/use-file-upload";
import { skillListOptions } from "@multica/core/workspace/queries";
import { ActorAvatar as ActorAvatarBase } from "@multica/ui/components/common/actor-avatar";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";
import { Slider } from "@multica/ui/components/ui/slider";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { ActorAvatar } from "../../common/actor-avatar";
import { CharCounter } from "./char-counter";
import { AvatarPicker, defaultAvatarFor } from "../../common/avatar-picker";
import { ModelDropdown } from "./model-dropdown";

type RuntimeFilter = "mine" | "all";
type WizardStep = "identity" | "tools" | "skills" | "context";

interface KeyValueEntry {
  id: number;
  key: string;
  value: string;
}

interface ArgEntry {
  id: number;
  value: string;
}

const STEPS: Array<{
  id: WizardStep;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "identity",
    title: "身份与模型",
    subtitle: "头像、职责、模型",
    icon: Sparkles,
  },
  {
    id: "tools",
    title: "工具",
    subtitle: "能力来源和参数",
    icon: Settings2,
  },
  {
    id: "skills",
    title: "技能",
    subtitle: "选择可调用能力",
    icon: FileText,
  },
  {
    id: "context",
    title: "工作上下文",
    subtitle: "工作范围与备注",
    icon: KeyRound,
  },
];

let nextEntryId = 0;

export function CreateAgentDialog({
  runtimes,
  runtimesLoading,
  members,
  currentUserId,
  template,
  initialRuntimeId,
  onClose,
  onCreate,
}: {
  runtimes: RuntimeDevice[];
  runtimesLoading?: boolean;
  members: MemberWithUser[];
  currentUserId: string | null;
  template?: Agent | null;
  initialRuntimeId?: string | null;
  onClose: () => void;
  onCreate: (data: CreateAgentRequest, skillIds?: string[]) => Promise<void>;
}) {
  const wsId = useWorkspaceId();
  const isDuplicate = !!template;
  const [step, setStep] = useState<WizardStep>("identity");
  const [name, setName] = useState(template ? `${template.name}（副本）` : "");
  const [description, setDescription] = useState(template?.description ?? "");
  // Origin 单 workspace 下 private/workspace 行为没差，但 backend 字段还在；
  // 默认 "workspace" 让 agent 列表不再标灰色「私有」徽章 —— 单人语境下没意义。
  // setter 暂时用不到（创建表单不再让用户切），但 state 留着以便 future toggle。
  const [visibility] = useState<AgentVisibility>(
    template?.visibility ?? "workspace",
  );
  const [model, setModel] = useState(template?.model ?? "");
  const [avatarUrl, setAvatarUrl] = useState(
    template?.avatar_url ?? defaultAvatarFor(template?.name ?? ""),
  );
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(
    template?.max_concurrent_tasks ?? 6,
  );
  const [instructions, setInstructions] = useState(template?.instructions ?? "");
  const [creating, setCreating] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const preferredRuntimeId = template?.runtime_id ?? initialRuntimeId ?? "";
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>(() => {
    const preferred = preferredRuntimeId
      ? runtimes.find((r) => r.id === preferredRuntimeId)
      : null;
    if (
      preferred &&
      currentUserId &&
      preferred.owner_id &&
      preferred.owner_id !== currentUserId
    ) {
      return "all";
    }
    return "mine";
  });
  const [argEntries, setArgEntries] = useState<ArgEntry[]>(
    (template?.custom_args ?? []).map((value) => ({ id: nextEntryId++, value })),
  );
  const [envEntries, setEnvEntries] = useState<KeyValueEntry[]>(
    Object.entries(template?.custom_env ?? {}).map(([key, value]) => ({
      id: nextEntryId++,
      key,
      value,
    })),
  );
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    template?.skills.map((s) => s.id) ?? [],
  );
  const [contextNotes, setContextNotes] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useFileUpload(api);
  const { data: workspaceSkills = [] } = useQuery(skillListOptions(wsId));

  const getOwnerMember = (ownerId: string | null) => {
    if (!ownerId) return null;
    return members.find((m) => m.user_id === ownerId) ?? null;
  };

  const hasOtherRuntimes = runtimes.some((r) => r.owner_id !== currentUserId);

  const filteredRuntimes = useMemo(() => {
    const filtered =
      runtimeFilter === "mine" && currentUserId
        ? runtimes.filter((r) => r.owner_id === currentUserId)
        : runtimes;
    return [...filtered].sort((a, b) => {
      if (a.owner_id === currentUserId && b.owner_id !== currentUserId) return -1;
      if (a.owner_id !== currentUserId && b.owner_id === currentUserId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [runtimes, runtimeFilter, currentUserId]);

  const [selectedRuntimeId, setSelectedRuntimeId] = useState(
    preferredRuntimeId || filteredRuntimes[0]?.id || "",
  );

  useEffect(() => {
    if (!selectedRuntimeId && preferredRuntimeId) {
      setSelectedRuntimeId(preferredRuntimeId);
      return;
    }
    if (!selectedRuntimeId && filteredRuntimes[0]) {
      setSelectedRuntimeId(filteredRuntimes[0].id);
    }
  }, [filteredRuntimes, preferredRuntimeId, selectedRuntimeId]);

  const selectedRuntime =
    runtimes.find((d) => d.id === selectedRuntimeId) ?? null;

  useEffect(() => {
    if (
      selectedRuntime &&
      runtimeFilter === "mine" &&
      currentUserId &&
      selectedRuntime.owner_id &&
      selectedRuntime.owner_id !== currentUserId
    ) {
      setRuntimeFilter("all");
    }
  }, [selectedRuntime, runtimeFilter, currentUserId]);
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const currentStep = STEPS.find((s) => s.id === step)!;
  const nextStep = STEPS[stepIndex + 1] ?? null;
  const progress = Math.round(((stepIndex + 1) / STEPS.length) * 100);
  const canSubmit = !!name.trim() && !!selectedRuntime && !creating;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const result = await upload(file);
      if (!result) return;
      setAvatarUrl(result.link);
      toast.success("头像已上传");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传头像失败");
    }
  };

  const handleNext = () => {
    if (step === "identity" && !name.trim()) {
      toast.error("请先填写智能体名称");
      return;
    }
    if (step === "tools" && !selectedRuntime) {
      toast.error("请先选择能力来源");
      return;
    }
    const next = STEPS[stepIndex + 1]?.id;
    if (next) setStep(next);
  };

  const handlePrevious = () => {
    const prev = STEPS[stepIndex - 1]?.id;
    if (prev) setStep(prev);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !selectedRuntime) return;
    const env = entriesToEnv(envEntries);
    if (env === "duplicate") {
      toast.error("环境变量键名重复");
      setStep("tools");
      return;
    }

    setCreating(true);
    try {
      const mergedInstructions = [
        instructions.trim(),
        contextNotes.trim()
          ? `工作范围与备注：\n${contextNotes.trim()}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const data: CreateAgentRequest = {
        name: name.trim(),
        description: description.trim(),
        runtime_id: selectedRuntime.id,
        visibility,
        avatar_url: avatarUrl,
        model: model.trim() || undefined,
        instructions: mergedInstructions || undefined,
        max_concurrent_tasks: maxConcurrentTasks,
        custom_args: entriesToArgs(argEntries),
      };

      if (Object.keys(env).length > 0) {
        data.custom_env = env;
      }
      if (template) {
        if (!data.instructions && template.instructions) {
          data.instructions = template.instructions;
        }
        if (data.custom_args?.length === 0 && template.custom_args.length) {
          data.custom_args = template.custom_args;
        }
        if (
          !data.custom_env &&
          !template.custom_env_redacted &&
          Object.keys(template.custom_env).length > 0
        ) {
          data.custom_env = template.custom_env;
        }
      }
      await onCreate(data, selectedSkillIds);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建智能体失败");
      setCreating(false);
    }
  };

  const toggleSkill = (skillId: string) => {
    setSelectedSkillIds((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId],
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="grid h-[calc(100vh-3rem)] max-h-[calc(100vh-3rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[min(1180px,calc(100vw-3rem))]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <Sparkles className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-2xl">
                {isDuplicate ? "复制智能体" : currentStep.title}
              </DialogTitle>
              <DialogDescription className="mt-1">
                第 {stepIndex + 1} 步 / 共 {STEPS.length} 步 · {currentStep.subtitle}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_340px]">
          <aside className="border-r bg-muted/25 p-4">
            <div className="space-y-2">
              {STEPS.map((item, index) => {
                const Icon = item.icon;
                const active = item.id === step;
                const done = index < stepIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStep(item.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors",
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xl",
                        active ? "bg-primary text-primary-foreground" : "bg-background",
                        done && !active && "bg-emerald-100 text-emerald-700",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.subtitle}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-8">
            <div className="mb-8 flex items-end gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-muted-foreground">
                  第 {stepIndex + 1} / {STEPS.length} 步
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-normal">
                  {currentStep.title}
                </h2>
              </div>
              <div className="w-32 text-right text-sm text-muted-foreground">
                完成 {progress}%
              </div>
            </div>
            <div className="mb-8 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>

            {step === "identity" && (
              <IdentityStep
                name={name}
                setName={setName}
                description={description}
                setDescription={setDescription}
                avatarUrl={avatarUrl}
                setAvatarUrl={setAvatarUrl}
                uploading={uploading}
                onUploadClick={() => fileInputRef.current?.click()}
                model={model}
                setModel={setModel}
                selectedRuntime={selectedRuntime}
              />
            )}

            {step === "tools" && (
              <ToolsStep
                runtimes={runtimes}
                runtimesLoading={runtimesLoading}
                runtimeOpen={runtimeOpen}
                setRuntimeOpen={setRuntimeOpen}
                selectedRuntimeId={selectedRuntimeId}
                setSelectedRuntimeId={setSelectedRuntimeId}
                selectedRuntime={selectedRuntime}
                filteredRuntimes={filteredRuntimes}
                hasOtherRuntimes={hasOtherRuntimes}
                runtimeFilter={runtimeFilter}
                setRuntimeFilter={setRuntimeFilter}
                getOwnerMember={getOwnerMember}
                maxConcurrentTasks={maxConcurrentTasks}
                setMaxConcurrentTasks={setMaxConcurrentTasks}
                argEntries={argEntries}
                setArgEntries={setArgEntries}
                envEntries={envEntries}
                setEnvEntries={setEnvEntries}
                instructions={instructions}
                setInstructions={setInstructions}
              />
            )}

            {step === "skills" && (
              <SkillsStep
                skills={workspaceSkills}
                selectedSkillIds={selectedSkillIds}
                onToggleSkill={toggleSkill}
              />
            )}

            {step === "context" && (
              <ContextStep
                contextNotes={contextNotes}
                setContextNotes={setContextNotes}
              />
            )}
          </main>

          <aside className="border-l bg-muted/20 p-8">
            <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-muted-foreground" />
              智能体预览
            </p>
            <p className="mt-5 text-base text-muted-foreground">
              预览智能体效果
            </p>
            <PreviewCard
              name={name}
              description={description}
              avatarUrl={avatarUrl}
              styleLabel="本地"
              skillCount={selectedSkillIds.length}
              runtimeName={selectedRuntime?.name}
            />
            <p className="mt-8 text-xs text-muted-foreground">
              技能会在创建后自动绑定；最后一步写的工作范围会拼到系统指令尾部，每次派任务时一起注入。
            </p>
          </aside>
        </div>

        <DialogFooter className="items-center px-8 py-5 sm:justify-between">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={handlePrevious}
            disabled={stepIndex === 0 || creating}
          >
            上一步
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button type="button" onClick={handleNext}>
                下一步：{nextStep?.title ?? "完成"}
              </Button>
            ) : (
              <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
                {creating ? "创建中..." : isDuplicate ? "创建副本" : "创建智能体"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IdentityStep({
  name,
  setName,
  description,
  setDescription,
  avatarUrl,
  setAvatarUrl,
  uploading,
  onUploadClick,
  model,
  setModel,
  selectedRuntime,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  avatarUrl: string;
  setAvatarUrl: (v: string) => void;
  uploading: boolean;
  onUploadClick: () => void;
  model: string;
  setModel: (v: string) => void;
  selectedRuntime: RuntimeDevice | null;
}) {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Label>名称 *</Label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：我的编程助手"
          className="h-12 rounded-lg text-base"
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>智能体头像</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onUploadClick}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            上传自定义图片
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          挑一个内置头像，或上传自己的图片。点「换一批」可以从更多备选里随机刷新。
        </p>
        <div className="rounded-lg border bg-background p-4">
          <AvatarPicker
            value={avatarUrl}
            onChange={setAvatarUrl}
            idPrefix="agent-avatar"
            tileSize={64}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>描述</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="描述这个智能体的功能..."
          maxLength={AGENT_DESCRIPTION_MAX_LENGTH}
          className="min-h-28 rounded-lg text-base"
        />
        <CharCounter
          length={[...description].length}
          max={AGENT_DESCRIPTION_MAX_LENGTH}
        />
      </div>

      {/* Origin 是单用户单 workspace 工作台，没有协作 / 共享 / 角色概念，
          所以可见性选项已经移除。后端 visibility 字段保持默认 "workspace"
          以兼容上游 schema —— 单 user 看不到差异。 */}

      <ModelDropdown
        runtimeId={selectedRuntime?.id ?? null}
        runtimeOnline={selectedRuntime?.status === "online"}
        value={model}
        onChange={setModel}
        disabled={!selectedRuntime}
      />
      <p className="text-xs text-muted-foreground">
        留空时继承运行环境默认模型；选择或输入模型后，只会保存到当前智能体，不会影响其他智能体。
      </p>
    </div>
  );
}

function ToolsStep({
  runtimes,
  runtimesLoading,
  runtimeOpen,
  setRuntimeOpen,
  selectedRuntimeId,
  setSelectedRuntimeId,
  selectedRuntime,
  filteredRuntimes,
  hasOtherRuntimes,
  runtimeFilter,
  setRuntimeFilter,
  getOwnerMember,
  maxConcurrentTasks,
  setMaxConcurrentTasks,
  argEntries,
  setArgEntries,
  envEntries,
  setEnvEntries,
  instructions,
  setInstructions,
}: {
  runtimes: RuntimeDevice[];
  runtimesLoading?: boolean;
  runtimeOpen: boolean;
  setRuntimeOpen: (v: boolean) => void;
  selectedRuntimeId: string;
  setSelectedRuntimeId: (v: string) => void;
  selectedRuntime: RuntimeDevice | null;
  filteredRuntimes: RuntimeDevice[];
  hasOtherRuntimes: boolean;
  runtimeFilter: RuntimeFilter;
  setRuntimeFilter: (v: RuntimeFilter) => void;
  getOwnerMember: (ownerId: string | null) => MemberWithUser | null;
  maxConcurrentTasks: number;
  setMaxConcurrentTasks: (v: number) => void;
  argEntries: ArgEntry[];
  setArgEntries: (v: ArgEntry[]) => void;
  envEntries: KeyValueEntry[];
  setEnvEntries: (v: KeyValueEntry[]) => void;
  instructions: string;
  setInstructions: (v: string) => void;
}) {
  const addArg = () => setArgEntries([...argEntries, { id: nextEntryId++, value: "" }]);
  const addEnv = () =>
    setEnvEntries([...envEntries, { id: nextEntryId++, key: "", value: "" }]);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>能力来源 *</Label>
          {hasOtherRuntimes && (
            <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
              <RuntimeFilterButton
                active={runtimeFilter === "mine"}
                onClick={() => {
                  setRuntimeFilter("mine");
                  setSelectedRuntimeId("");
                }}
              >
                我的
              </RuntimeFilterButton>
              <RuntimeFilterButton
                active={runtimeFilter === "all"}
                onClick={() => {
                  setRuntimeFilter("all");
                  setSelectedRuntimeId("");
                }}
              >
                全部
              </RuntimeFilterButton>
            </div>
          )}
        </div>
        <Popover open={runtimeOpen} onOpenChange={setRuntimeOpen}>
          <PopoverTrigger
            disabled={runtimes.length === 0 && !runtimesLoading}
            className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            {runtimesLoading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : selectedRuntime ? (
              <ProviderLogo provider={selectedRuntime.provider} className="h-4 w-4 shrink-0" />
            ) : (
              <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">
                  {runtimesLoading
                    ? "正在加载能力来源..."
                    : selectedRuntime?.name ?? "没有可用能力来源"}
                </span>
                {selectedRuntime?.runtime_mode === "cloud" && (
                  <Badge variant="secondary">云端</Badge>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {selectedRuntime
                  ? getOwnerMember(selectedRuntime.owner_id)?.name ??
                    selectedRuntime.device_info
                  : "创建智能体前需要先注册能力来源"}
              </div>
            </div>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", runtimeOpen && "rotate-180")} />
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-72 w-[var(--anchor-width)] overflow-y-auto p-1">
            {filteredRuntimes.map((device) => {
              const ownerMember = getOwnerMember(device.owner_id);
              return (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => {
                    setSelectedRuntimeId(device.id);
                    setRuntimeOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                    device.id === selectedRuntimeId ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  <ProviderLogo provider={device.provider} className="h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{device.name}</span>
                      {device.runtime_mode === "cloud" && (
                        <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-xs font-medium text-info">
                          云端
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      {ownerMember ? (
                        <>
                          <ActorAvatar actorType="member" actorId={ownerMember.user_id} size={14} />
                          <span className="truncate">{ownerMember.name}</span>
                        </>
                      ) : (
                        <span className="truncate">{device.device_info}</span>
                      )}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      device.status === "online" ? "bg-success" : "bg-muted-foreground/40",
                    )}
                  />
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>并发任务数</Label>
          <span className="font-mono text-sm text-muted-foreground">
            {maxConcurrentTasks}
          </span>
        </div>
        <Slider
          value={[maxConcurrentTasks]}
          min={1}
          max={12}
          step={1}
          onValueChange={(value) => {
            const nextValue = Array.isArray(value) ? value[0] : value;
            setMaxConcurrentTasks(nextValue ?? 1);
          }}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>系统指令</Label>
          <span className="text-xs text-muted-foreground">可选</span>
        </div>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="写下这个智能体的工作原则、输出格式或边界..."
            className="min-h-24 rounded-lg"
        />
      </div>

      <EditableList
        title="自定义 CLI 参数"
        description="例如：--model claude-sonnet-4。多个 token 会按空白拆分。"
        addLabel="添加参数"
        onAdd={addArg}
      >
        {argEntries.map((entry) => (
          <div key={entry.id} className="flex items-center gap-2">
            <Input
              value={entry.value}
              onChange={(e) =>
                setArgEntries(
                  argEntries.map((item) =>
                    item.id === entry.id ? { ...item, value: e.target.value } : item,
                  ),
                )
              }
              placeholder="--flag value"
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setArgEntries(argEntries.filter((item) => item.id !== entry.id))
              }
            >
              移除
            </Button>
          </div>
        ))}
      </EditableList>

      <EditableList
        title="环境变量"
        description="敏感值会传给智能体运行进程，请只写必要配置。"
        addLabel="添加变量"
        onAdd={addEnv}
      >
        {envEntries.map((entry) => (
          <div key={entry.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input
              value={entry.key}
              onChange={(e) =>
                setEnvEntries(
                  envEntries.map((item) =>
                    item.id === entry.id ? { ...item, key: e.target.value } : item,
                  ),
                )
              }
              placeholder="KEY"
              className="font-mono text-xs"
            />
            <Input
              value={entry.value}
              onChange={(e) =>
                setEnvEntries(
                  envEntries.map((item) =>
                    item.id === entry.id ? { ...item, value: e.target.value } : item,
                  ),
                )
              }
              placeholder="value"
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setEnvEntries(envEntries.filter((item) => item.id !== entry.id))
              }
            >
              移除
            </Button>
          </div>
        ))}
      </EditableList>
    </div>
  );
}

function SkillsStep({
  skills,
  selectedSkillIds,
  onToggleSkill,
}: {
  skills: Array<{ id: string; name: string; description?: string }>;
  selectedSkillIds: string[];
  onToggleSkill: (skillId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        选择这个智能体创建后就能直接调用的工作区技能。提交时会先创建智能体，再自动完成技能绑定。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {skills.map((skill) => {
          const selected = selectedSkillIds.includes(skill.id);
          return (
            <button
              key={skill.id}
              type="button"
              onClick={() => onToggleSkill(skill.id)}
              className={cn(
                "rounded-lg border p-4 text-left transition-all hover:border-primary/40",
                selected && "border-primary bg-primary/5",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{skill.name}</div>
                  <div className="line-clamp-2 text-xs text-muted-foreground">
                    {skill.description || "暂无描述"}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {skills.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          当前工作区还没有技能。创建智能体后，可以在详情页新增或绑定技能。
        </div>
      )}
    </div>
  );
}

function ContextStep({
  contextNotes,
  setContextNotes,
}: {
  contextNotes: string;
  setContextNotes: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-muted/30 p-5">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1.5 text-sm leading-relaxed">
            <p className="font-semibold text-foreground">这一段会拼到智能体的系统指令最后</p>
            <p className="text-muted-foreground">
              用来告诉这个智能体它的「工作范围」和「禁区」——具体盯哪些目录 / 仓库 / 文档，
              以及什么不要碰。每次派任务时都会跟前面的系统指令一起注入。
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Label>工作范围与备注</Label>
        <Textarea
          value={contextNotes}
          onChange={(e) => setContextNotes(e.target.value)}
          placeholder={[
            "建议写清楚三件事：",
            "1) 这个智能体主要负责什么 —— 比如「前端表单组件，关注 packages/views/forms/」",
            "2) 命名 / 命令 / 风格偏好 —— 比如「写 React 用函数式组件 + TypeScript」",
            "3) 禁区 —— 比如「不要碰 server/internal/handler/auth.go，那是上游核心」",
          ].join("\n")}
          className="min-h-40 rounded-lg"
        />
      </div>
    </div>
  );
}

function PreviewCard({
  name,
  description,
  avatarUrl,
  styleLabel,
  skillCount,
  runtimeName,
}: {
  name: string;
  description: string;
  avatarUrl: string;
  styleLabel: string;
  skillCount: number;
  runtimeName?: string;
}) {
  const displayName = name.trim() || "新建智能体";
  const displayDescription =
    description.trim() || "我是一个专业的智能体助手，随时可以为你提供帮助。";

  return (
    <div className="mt-6 overflow-hidden rounded-xl border bg-background shadow-sm">
      <div className="h-28 bg-muted" />
      <div className="-mt-10 px-6 pb-6 text-center">
        <span className="inline-flex rounded-xl bg-background p-2 shadow-sm ring-1 ring-border">
          <ActorAvatarBase
            name={displayName}
            initials={displayName.slice(0, 1)}
            avatarUrl={avatarUrl}
            isAgent
            size={76}
            className="rounded-lg"
          />
        </span>
        <h3 className="mt-4 truncate text-xl font-semibold">{displayName}</h3>
        <Badge variant="secondary" className="mt-2">
          本地智能体
        </Badge>
        <p className="mt-5 line-clamp-3 text-sm italic leading-relaxed text-muted-foreground">
          “{displayDescription}”
        </p>
        <div className="mt-6 border-t pt-5 text-left">
          <PreviewRow label="风格" value={styleLabel} />
          <PreviewRow label="技能" value={`${skillCount} 个预选`} />
          <PreviewRow label="能力来源" value={runtimeName ?? "待选择"} />
        </div>
      </div>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}


function RuntimeFilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-0.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function EditableList({
  title,
  description,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  description: string;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label>{title}</Label>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </Button>
      </div>
      <div className="space-y-2">
        {children || (
          <div className="rounded-lg border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
            暂未配置
          </div>
        )}
      </div>
    </div>
  );
}

function entriesToArgs(entries: ArgEntry[]): string[] {
  return entries.flatMap((entry) => entry.value.trim().split(/\s+/)).filter(Boolean);
}

function entriesToEnv(entries: KeyValueEntry[]): Record<string, string> | "duplicate" {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(result, key)) return "duplicate";
    result[key] = entry.value;
  }
  return result;
}
