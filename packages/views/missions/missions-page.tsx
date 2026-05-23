"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Crown,
  Filter,
  Layers3,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Network,
  Play,
  Search,
  Send,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import type { WorkspacePaths } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import {
  missionDetailOptions,
  missionListOptions,
  useArchiveMission,
  useCreateMission,
} from "@multica/core/missions";
import { teamMessagesOptions, usePostTeamMessage } from "@multica/core/teams";
import type {
  Agent,
  CreateMissionPlanItemRequest,
  Mission,
  MissionDetail,
  MissionExecutionMode,
  MissionPlanItem,
  MissionRiskLevel,
  MissionStatus,
  TeamMessage,
} from "@multica/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@multica/ui/components/ui/sheet";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@multica/ui/components/ui/tabs";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";
import { PageHeader } from "../layout/page-header";
import { ActorAvatar } from "../common/actor-avatar";
import { AvatarNamePickerItem } from "../common/actor-picker/avatar-name-picker";
import { AppLink } from "../navigation";
import { ToolBindingsPanel } from "../tool-bindings";

const SAMPLE_PROMPTS = [
  "把这个仓库改造成 Origin 本地多智能体工作台，先跑通 Mission 到团队群聊的主流程。",
  "调研我的本地 agent 能力池，给我一套 Codex / Claude / DeepSeek 的分工方案。",
  "复盘最近一次产品改造任务，沉淀可复用的记忆和技能候选。",
];

export const missionHomeSections = [
  { title: "Mission 总览" },
  { title: "待确认队列" },
  { title: "Mission 列表" },
] as const;

export const missionCreateFields = [
  "目标",
  "负责人",
  "协作成员",
  "风险级别",
  "执行模式",
] as const;

export const missionDetailTabs = [
  { key: "progress", label: "进度", items: ["计划树", "执行进度"] },
  { key: "chat", label: "群聊", items: ["Mission 群聊"] },
  {
    key: "details",
    label: "详情",
    items: ["团队", "能力 / 工具绑定", "执行记录", "记忆候选", "风险说明"],
  },
] as const;

export function shouldLoadMissionDetail(selectedId: string | null, drawerOpen: boolean) {
  return !!selectedId && drawerOpen;
}

export function closeCreateMissionDialog({
  isPending,
  reset,
  onOpenChange,
}: {
  isPending: boolean;
  reset: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  if (isPending) return;
  reset();
  onOpenChange(false);
}

function titleFromPrompt(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized) return "未命名任务";
  const first = normalized.split(/[。.!?\n]/)[0] ?? normalized;
  return first.length > 42 ? `${first.slice(0, 42)}...` : first;
}

function planFromPrompt(prompt: string, captainId: string, memberIds: string[]): CreateMissionPlanItemRequest[] {
  const memberFor = (index: number) => memberIds[index % Math.max(memberIds.length, 1)] ?? captainId;
  return [
    {
      title: "负责人拆解目标和验收标准",
      description: `把一句话目标拆成计划树、风险点和成员分工。\n\n原始目标：${prompt.trim()}`,
      phase: "plan",
      priority: "high",
      risk_level: "low",
      assigned_agent_id: captainId,
    },
    {
      title: "成员并行执行第一批子任务",
      description: "按负责人分派执行具体任务，并在群聊中回传过程、结果、阻塞和证据。",
      phase: "execute",
      priority: "high",
      risk_level: "low",
      assigned_agent_id: memberFor(0),
    },
    {
      title: "复核交付并沉淀长期资产",
      description: "检查输出质量，生成复盘摘要、记忆候选和技能候选，等待用户确认沉淀。",
      phase: "verify",
      priority: "medium",
      risk_level: "medium",
      assigned_agent_id: memberFor(1),
    },
  ];
}

function statusLabel(status: Mission["status"]) {
  return {
    draft: "草稿",
    planning: "规划中",
    waiting_confirmation: "待确认",
    executing: "执行中",
    blocked: "受阻",
    completed: "已完成",
    archived: "已归档",
  }[status] ?? status;
}

function statusTone(status: Mission["status"]) {
  if (status === "completed") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "blocked") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (status === "waiting_confirmation") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "executing") return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  return "border-muted-foreground/20 bg-muted text-muted-foreground";
}

function phaseLabel(phase: MissionPlanItem["phase"]) {
  return {
    plan: "规划",
    execute: "执行",
    verify: "复核",
    ship: "交付",
  }[phase] ?? phase;
}

function riskLabel(risk: MissionRiskLevel) {
  return { low: "低风险", medium: "中风险", high: "高风险" }[risk];
}

function executionModeLabel(mode: MissionExecutionMode) {
  return { auto: "自动执行", confirm: "关键确认", step_confirm: "逐步确认" }[mode];
}

function planStatusLabel(status: MissionPlanItem["status"]) {
  return {
    todo: "待办",
    in_progress: "进行中",
    blocked: "受阻",
    done: "完成",
    cancelled: "取消",
  }[status] ?? status;
}

function formatTime(raw: string) {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function activeAgents(agents: Agent[]) {
  return agents.filter((agent) => !agent.archived_at);
}

function needsAttention(mission: Mission) {
  return mission.status === "waiting_confirmation" || mission.status === "blocked" || mission.risk_level !== "low";
}

export function MissionsPage() {
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();
  const wsPaths = useWorkspacePaths();
  const { data: agents = [], isLoading: agentsLoading } = useQuery(agentListOptions(wsId));
  const { data: missions = [], isLoading: missionsLoading } = useQuery(missionListOptions(wsId));
  const createMission = useCreateMission();
  const archiveMission = useArchiveMission();

  const availableAgents = useMemo(() => activeAgents(agents), [agents]);
  const agentById = useMemo(() => new Map(availableAgents.map((agent) => [agent.id, agent])), [availableAgents]);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<Mission | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | MissionStatus>("all");
  const [query, setQuery] = useState("");

  const drawerOpen = !!selectedMissionId;
  const detailQuery = useQuery({
    ...missionDetailOptions(wsId, selectedMissionId ?? ""),
    enabled: shouldLoadMissionDetail(selectedMissionId, drawerOpen),
  });
  const detail = detailQuery.data;
  const selectedMission =
    detail?.mission ?? missions.find((mission) => mission.id === selectedMissionId) ?? null;
  const { data: messagePage } = useQuery({
    ...teamMessagesOptions(wsId, detail?.mission.team_id ?? ""),
    enabled: shouldLoadMissionDetail(selectedMissionId, drawerOpen) && !!detail?.mission.team_id,
  });
  const postTeamMessage = usePostTeamMessage();

  const attentionMissions = useMemo(() => missions.filter(needsAttention), [missions]);
  const filteredMissions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return missions.filter((mission) => {
      const matchesStatus = statusFilter === "all" || mission.status === statusFilter;
      const matchesQuery =
        !normalized ||
        mission.title.toLowerCase().includes(normalized) ||
        mission.prompt.toLowerCase().includes(normalized);
      return matchesStatus && matchesQuery;
    });
  }, [missions, query, statusFilter]);
  const activeCount = missions.filter((mission) => mission.status !== "completed").length;
  const blockedCount = missions.filter((mission) => mission.status === "blocked").length;
  const waitingCount = missions.filter((mission) => mission.status === "waiting_confirmation").length;

  const archiveSelected = (mission: Mission) => {
    archiveMission.mutate(mission.id, {
      onSuccess: () => {
        toast.success("Mission 已归档");
        setConfirmArchive(null);
        setSelectedMissionId(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "归档失败"),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <PageHeader className="gap-1.5">
        <WorkspaceAvatar name={workspace?.name ?? "O"} size="sm" />
        <span className="text-sm text-muted-foreground">Origin / 原点工作台</span>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="text-sm font-medium">任务中枢</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl space-y-4 p-5">
          <section className="rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Network className="size-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-semibold">Mission 总览</h1>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    这里只看 Mission 的推进状态、待确认事项和快速定位。新建、详情和团队协作都进入弹窗或抽屉处理。
                  </p>
                </div>
              </div>
              <Button onClick={() => setCreateOpen(true)}>
                <Sparkles className="size-4" />
                新建 Mission
              </Button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <SummaryMetric label="活跃 Mission" value={activeCount} />
              <SummaryMetric label="待确认" value={waitingCount} tone={waitingCount > 0 ? "warning" : "default"} />
              <SummaryMetric label="受阻" value={blockedCount} tone={blockedCount > 0 ? "destructive" : "default"} />
            </div>
          </section>

          <section className="rounded-lg border bg-card">
            <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">待确认队列</h2>
              </div>
              <Badge variant="outline">{attentionMissions.length} 个需要处理</Badge>
            </div>
            <div className="p-4">
              {missionsLoading ? (
                <StackSkeleton rows={2} />
              ) : attentionMissions.length === 0 ? (
                <EmptyText text="暂无中高风险、待确认或受阻 Mission。" />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {attentionMissions.slice(0, 6).map((mission) => (
                    <AttentionCard
                      key={mission.id}
                      mission={mission}
                      captain={agentById.get(mission.captain_agent_id)}
                      onOpen={() => setSelectedMissionId(mission.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Mission 列表</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="h-8 w-56 pl-7"
                    placeholder="快速定位 Mission"
                  />
                </div>
                <FilterPills value={statusFilter} onChange={setStatusFilter} />
              </div>
            </div>
            <div className="p-4">
              {missionsLoading ? (
                <StackSkeleton rows={4} />
              ) : missions.length === 0 ? (
                <MissionEmptyState onCreate={() => setCreateOpen(true)} />
              ) : filteredMissions.length === 0 ? (
                <EmptyText text="没有匹配当前筛选条件的 Mission。" />
              ) : (
                <div className="divide-y rounded-lg border">
                  {filteredMissions.map((mission) => (
                    <MissionListRow
                      key={mission.id}
                      mission={mission}
                      captain={agentById.get(mission.captain_agent_id)}
                      onOpen={() => setSelectedMissionId(mission.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <CreateMissionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        agents={availableAgents}
        agentsLoading={agentsLoading}
        createMission={createMission}
        onCreated={(missionId) => setSelectedMissionId(missionId)}
      />

      <MissionDetailSheet
        open={drawerOpen}
        onOpenChange={(open) => {
          if (!open) setSelectedMissionId(null);
        }}
        mission={selectedMission}
        detail={detail}
        messages={messagePage?.messages ?? []}
        agentById={agentById}
        wsPaths={wsPaths}
        loading={detailQuery.isLoading}
        sending={postTeamMessage.isPending}
        onRequestArchive={(mission) => setConfirmArchive(mission)}
        onSend={(content) => {
          if (!detail?.mission.team_id) return;
          postTeamMessage.mutate(
            { teamId: detail.mission.team_id, content },
            { onError: (err) => toast.error(err instanceof Error ? err.message : "发送失败") },
          );
        }}
      />

      {confirmArchive && (
        <AlertDialog open onOpenChange={(open) => !open && setConfirmArchive(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>归档 Mission</AlertDialogTitle>
              <AlertDialogDescription>
                归档后它会从默认任务中枢列表中隐藏，历史团队和记录仍保留可查。确认归档「{confirmArchive.title}」？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={archiveMission.isPending}>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={archiveMission.isPending}
                onClick={() => archiveSelected(confirmArchive)}
              >
                {archiveMission.isPending ? "归档中..." : "确认归档"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function CreateMissionDialog({
  open,
  onOpenChange,
  agents,
  agentsLoading,
  createMission,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
  agentsLoading: boolean;
  createMission: ReturnType<typeof useCreateMission>;
  onCreated: (missionId: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [captainId, setCaptainId] = useState<string>("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [riskLevel, setRiskLevel] = useState<MissionRiskLevel>("low");
  const [executionMode, setExecutionMode] = useState<MissionExecutionMode>("auto");

  const selectedCaptainId = captainId || agents[0]?.id || "";
  const selectedMembers = memberIds.filter((id) => id !== selectedCaptainId);

  const reset = () => {
    setPrompt("");
    setCaptainId("");
    setMemberIds([]);
    setRiskLevel("low");
    setExecutionMode("auto");
  };

  const submitMission = () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast.error("先输入 Mission 目标");
      return;
    }
    if (!selectedCaptainId) {
      toast.error("先选择团队负责人");
      return;
    }
    createMission.mutate(
      {
        title: titleFromPrompt(trimmed),
        prompt: trimmed,
        captain_agent_id: selectedCaptainId,
        member_agent_ids: selectedMembers,
        risk_level: riskLevel,
        execution_mode: executionMode,
        plan_items: planFromPrompt(trimmed, selectedCaptainId, selectedMembers),
      },
      {
        onSuccess: (created) => {
          toast.success("Mission 已创建，负责人正在接管");
          reset();
          onOpenChange(false);
          onCreated(created.mission.id);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Mission 创建失败");
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeCreateMissionDialog({
            isPending: createMission.isPending,
            reset,
            onOpenChange,
          });
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建 Mission</DialogTitle>
          <DialogDescription>
            先明确目标，再选择负责人、协作成员、风险级别和执行模式。创建后进入详情抽屉继续跟进。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="space-y-2">
            <Label>目标</Label>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              className="min-h-28 resize-none bg-background text-sm"
              placeholder="描述你希望智能体团队交付什么..."
            />
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_PROMPTS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setPrompt(sample)}
                  className="rounded-md border bg-background px-2 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {sample.slice(0, 24)}...
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <AgentSelector
              label="负责人"
              agents={agents}
              selectedId={selectedCaptainId}
              onSelect={(id) => {
                setCaptainId(id);
                setMemberIds((prev) => prev.filter((memberId) => memberId !== id));
              }}
              emptyLabel={agentsLoading ? "加载智能体..." : "还没有可用智能体"}
            />

            <MemberSelector
              agents={agents.filter((agent) => agent.id !== selectedCaptainId)}
              selectedIds={selectedMembers}
              onToggle={(id) => {
                setMemberIds((prev) =>
                  prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
                );
              }}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <OptionGroup
              label="风险级别"
              value={riskLevel}
              options={[
                ["low", "低风险"],
                ["medium", "中风险"],
                ["high", "高风险"],
              ]}
              onChange={(value) => setRiskLevel(value as MissionRiskLevel)}
            />
            <OptionGroup
              label="执行模式"
              value={executionMode}
              options={[
                ["auto", "自动执行"],
                ["confirm", "关键确认"],
                ["step_confirm", "逐步确认"],
              ]}
              onChange={(value) => setExecutionMode(value as MissionExecutionMode)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              closeCreateMissionDialog({
                isPending: createMission.isPending,
                reset,
                onOpenChange,
              })
            }
            disabled={createMission.isPending}
          >
            取消
          </Button>
          <Button onClick={submitMission} disabled={createMission.isPending || !selectedCaptainId}>
            {createMission.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            创建 Mission
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentSelector({
  label,
  agents,
  selectedId,
  onSelect,
  emptyLabel,
}: {
  label: string;
  agents: Agent[];
  selectedId: string;
  onSelect: (id: string) => void;
  emptyLabel: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border bg-background p-1">
        {agents.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">{emptyLabel}</div>
        ) : (
          agents.map((agent) => (
            <AvatarNamePickerItem
              key={agent.id}
              actorType="agent"
              actorId={agent.id}
              label={agent.name}
              description={agent.description || agent.model || agent.status}
              selected={selectedId === agent.id}
              onSelect={() => onSelect(agent.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MemberSelector({
  agents,
  selectedIds,
  onToggle,
}: {
  agents: Agent[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">协作成员</Label>
        <span className="text-[11px] text-muted-foreground">{selectedIds.length} 位</span>
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border bg-background p-1">
        {agents.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">没有其他可选成员</div>
        ) : (
          agents.map((agent) => (
            <AvatarNamePickerItem
              key={agent.id}
              actorType="agent"
              actorId={agent.id}
              label={agent.name}
              description={agent.description || agent.model || agent.status}
              selected={selectedIds.includes(agent.id)}
              onSelect={() => onToggle(agent.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OptionGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="grid gap-2">
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            className={cn(
              "rounded-md border px-3 py-2 text-left text-sm transition-colors",
              value === optionValue
                ? "border-primary/40 bg-primary/10 text-primary"
                : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterPills({
  value,
  onChange,
}: {
  value: "all" | MissionStatus;
  onChange: (value: "all" | MissionStatus) => void;
}) {
  const options: Array<["all" | MissionStatus, string]> = [
    ["all", "全部"],
    ["executing", "执行中"],
    ["waiting_confirmation", "待确认"],
    ["blocked", "受阻"],
    ["completed", "完成"],
  ];
  return (
    <div className="inline-flex rounded-lg border bg-background p-1">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          type="button"
          onClick={() => onChange(optionValue)}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs transition-colors",
            value === optionValue ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {optionValue === "all" && <Filter className="size-3" />}
          {label}
        </button>
      ))}
    </div>
  );
}

function AttentionCard({
  mission,
  captain,
  onOpen,
}: {
  mission: Mission;
  captain?: Agent;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <Badge variant="outline" className={statusTone(mission.status)}>{statusLabel(mission.status)}</Badge>
        <span className="text-[11px] text-muted-foreground">{riskLabel(mission.risk_level)}</span>
      </div>
      <div className="mt-2 line-clamp-2 text-sm font-medium">{mission.title}</div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {captain ? <ActorAvatar actorType="agent" actorId={captain.id} size={18} showStatusDot /> : <Bot className="size-3.5" />}
          <span className="truncate">{captain?.name ?? "未绑定负责人"}</span>
        </span>
        <span>{formatTime(mission.updated_at)}</span>
      </div>
    </button>
  );
}

function MissionListRow({
  mission,
  captain,
  onOpen,
}: {
  mission: Mission;
  captain?: Agent;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <Network className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 truncate text-sm font-medium">{mission.title}</div>
          {needsAttention(mission) && (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              待处理
            </Badge>
          )}
        </div>
        <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{mission.prompt}</div>
      </div>
      <div className="hidden min-w-36 items-center gap-2 text-xs text-muted-foreground md:flex">
        {captain ? <ActorAvatar actorType="agent" actorId={captain.id} size={18} showStatusDot /> : <Bot className="size-3.5" />}
        <span className="truncate">{captain?.name ?? "未绑定负责人"}</span>
      </div>
      <Badge variant="outline" className={cn("hidden shrink-0 md:inline-flex", statusTone(mission.status))}>{statusLabel(mission.status)}</Badge>
      <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground lg:block">{formatTime(mission.updated_at)}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function MissionEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-background text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border bg-card">
        <Sparkles className="size-6 text-muted-foreground" />
      </div>
      <div>
        <div className="text-sm font-medium">还没有 Mission</div>
        <div className="mt-1 text-xs text-muted-foreground">从一个清晰目标开始，交给负责人组织智能体推进。</div>
      </div>
      <Button onClick={onCreate}>
        <Sparkles className="size-4" />
        新建 Mission
      </Button>
    </div>
  );
}

function MissionDetailSheet({
  open,
  onOpenChange,
  mission,
  detail,
  messages,
  agentById,
  wsPaths,
  loading,
  sending,
  onRequestArchive,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mission: Mission | null;
  detail?: MissionDetail;
  messages: TeamMessage[];
  agentById: Map<string, Agent>;
  wsPaths: WorkspacePaths;
  loading: boolean;
  sending: boolean;
  onRequestArchive: (mission: Mission) => void;
  onSend: (content: string) => void;
}) {
  if (!mission) {
    return <Sheet open={open} onOpenChange={onOpenChange} />;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(1180px,96vw)] gap-0 p-0 sm:max-w-none">
        <SheetHeader className="border-b pr-12">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={statusTone(mission.status)}>{statusLabel(mission.status)}</Badge>
                <span className="text-xs text-muted-foreground">{formatTime(mission.updated_at)}</span>
              </div>
              <SheetTitle className="mt-2 truncate">{mission.title}</SheetTitle>
              <SheetDescription className="line-clamp-2">{mission.prompt}</SheetDescription>
            </div>
            <MissionMoreMenu mission={mission} onRequestArchive={onRequestArchive} />
          </div>
        </SheetHeader>

        <Tabs defaultValue="progress" className="min-h-0 flex-1 gap-0">
          <div className="border-b px-4 py-2">
            <TabsList>
              {missionDetailTabs.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="progress" className="min-h-0 overflow-y-auto p-4">
            <MissionProgressPanel
              mission={mission}
              detail={detail}
              agentById={agentById}
              loading={loading}
            />
          </TabsContent>
          <TabsContent value="chat" className="min-h-0">
            <MissionChatPanel
              messages={messages}
              agentById={agentById}
              sending={sending}
              onSend={onSend}
            />
          </TabsContent>
          <TabsContent value="details" className="min-h-0 overflow-y-auto p-4">
            <MissionDetailsPanel
              mission={mission}
              detail={detail}
              agentById={agentById}
              wsPaths={wsPaths}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function MissionMoreMenu({
  mission,
  onRequestArchive,
}: {
  mission: Mission;
  onRequestArchive: (mission: Mission) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Mission 操作" />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onRequestArchive(mission)}
        >
          <Archive className="size-3.5" />
          归档 Mission
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MissionProgressPanel({
  mission,
  detail,
  agentById,
  loading,
}: {
  mission: Mission;
  detail?: MissionDetail;
  agentById: Map<string, Agent>;
  loading: boolean;
}) {
  const planItems: MissionPlanItem[] = detail?.plan_items ?? [];
  const events = detail?.events ?? [];
  const progress = planItems.length
    ? Math.round((planItems.filter((item) => item.status === "done").length / planItems.length) * 100)
    : 0;
  const captain = agentById.get(mission.captain_agent_id);

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,0.62fr)_minmax(280px,0.38fr)]">
      <section className="min-w-0">
        <div className="mb-4 grid grid-cols-3 gap-2">
          <Metric label="计划进度" value={`${progress}%`} />
          <Metric label="步骤" value={planItems.length} />
          <Metric label="事件" value={events.length} />
        </div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">计划树</h3>
          {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="mt-3 space-y-2">
          {planItems.length === 0 ? (
            <EmptyText text={loading ? "正在加载计划树..." : "等待负责人生成计划。"} />
          ) : (
            planItems.map((item, index) => (
              <PlanItemRow
                key={item.id}
                item={item}
                index={index}
                agent={item.assigned_agent_id ? agentById.get(item.assigned_agent_id) : undefined}
              />
            ))
          )}
        </div>
      </section>

      <section className="min-w-0">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            {captain ? <ActorAvatar actorType="agent" actorId={captain.id} size={28} showStatusDot /> : <Bot className="size-4" />}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{captain?.name ?? "未绑定负责人"}</div>
              <div className="text-xs text-muted-foreground">负责人</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Capability label="风险级别" value={riskLabel(mission.risk_level)} />
            <Capability label="执行模式" value={executionModeLabel(mission.execution_mode)} />
          </div>
        </div>

        <div className="mt-4 rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold">执行事件</h3>
          <div className="mt-3 space-y-2">
            {events.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无事件</div>
            ) : (
              events.slice(-8).reverse().map((event) => (
                <div key={event.id} className="rounded-md border bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{event.title}</span>
                    <span className="text-[11px] text-muted-foreground">{formatTime(event.created_at)}</span>
                  </div>
                  {event.body && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{event.body}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function MissionChatPanel({
  messages,
  agentById,
  sending,
  onSend,
}: {
  messages: TeamMessage[];
  agentById: Map<string, Agent>;
  sending: boolean;
  onSend: (content: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <MessageSquare className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Mission 群聊</span>
        <span className="ml-auto text-xs text-muted-foreground">负责人和成员的协作过程</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <MessageSquare className="size-8 opacity-40" />
            群聊还没有消息
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              agent={message.sender_agent_id ? agentById.get(message.sender_agent_id) : undefined}
            />
          ))
        )}
      </div>
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            className="min-h-12 resize-none bg-background text-sm"
            placeholder="给负责人或团队补充上下文..."
          />
          <Button
            className="self-end"
            disabled={sending || !draft.trim()}
            onClick={() => {
              const content = draft.trim();
              if (!content) return;
              setDraft("");
              onSend(content);
            }}
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MissionDetailsPanel({
  mission,
  detail,
  agentById,
  wsPaths,
}: {
  mission: Mission;
  detail?: MissionDetail;
  agentById: Map<string, Agent>;
  wsPaths: WorkspacePaths;
}) {
  const team = detail?.team;
  const members = team?.members ?? [];
  const assignments = detail?.assignments ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">团队</h3>
        </div>
        <div className="mt-3 space-y-2">
          {members.length === 0 ? (
            <div className="text-sm text-muted-foreground">未绑定团队</div>
          ) : (
            members.map((member) => {
              const agent = agentById.get(member.agent_id);
              return (
                <div key={member.agent_id} className="flex items-center gap-2 rounded-md border bg-background p-2">
                  <ActorAvatar actorType="agent" actorId={member.agent_id} size={24} showStatusDot />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{agent?.name ?? member.agent_id}</div>
                    <div className="text-xs text-muted-foreground">{member.role === "captain" ? "负责人" : "成员"}</div>
                  </div>
                  {member.role === "captain" && <Crown className="size-4 text-amber-500" />}
                </div>
              );
            })
          )}
        </div>
        {team && (
          <Button className="mt-4" variant="outline" render={<AppLink href={wsPaths.teamDetail(team.id)} />}>
            打开团队房间
            <ChevronRight className="size-4" />
          </Button>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">能力 / 工具绑定</h3>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Capability label="本地 CLI" value="Claude / Codex" />
          <Capability label="外部 API" value="按能力池配置" />
          <Capability label="低风险" value="自动执行" />
          <Capability label="中高风险" value="确认队列" />
        </div>
        <ToolBindingsPanel
          subject={{ kind: "mission", id: mission.id }}
          className="mt-4"
        />
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2">
          <Layers3 className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">执行记录</h3>
        </div>
        <div className="mt-3 space-y-2">
          {assignments.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无派工记录</div>
          ) : (
            assignments.map((assignment) => {
              const agent = agentById.get(assignment.agent_id);
              return (
                <div key={assignment.id} className="rounded-md border bg-background p-2 text-xs">
                  <div className="flex items-center gap-2">
                    {agent && <ActorAvatar actorType="agent" actorId={agent.id} size={18} showStatusDot />}
                    <span className="min-w-0 flex-1 truncate font-medium">{agent?.name ?? assignment.agent_id}</span>
                    <span className="text-muted-foreground">{assignment.status}</span>
                  </div>
                  {assignment.task_id && <div className="mt-1 truncate text-muted-foreground">task {assignment.task_id}</div>}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">记忆候选</h3>
        </div>
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          <TimelineLine icon={<Clock3 className="size-3.5" />} text="Mission 完成后生成复盘摘要" />
          <TimelineLine icon={<Sparkles className="size-3.5" />} text="记忆候选等待用户确认" />
          <TimelineLine icon={<Bot className="size-3.5" />} text="技能候选会沉淀到负责人或成员详情页" />
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 lg:col-span-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">风险说明</h3>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          当前 Mission 风险等级：{riskLabel(mission.risk_level)}。中高风险操作会进入确认队列，低风险动作允许负责人自动派发。
        </p>
      </section>
    </div>
  );
}

function PlanItemRow({ item, index, agent }: { item: MissionPlanItem; index: number; agent?: Agent }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-xs tabular-nums">{index + 1}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{item.title}</span>
            <Badge variant="outline">{phaseLabel(item.phase)}</Badge>
            <Badge
              variant="outline"
              className={item.risk_level === "high" ? "text-destructive" : item.risk_level === "medium" ? "text-amber-600" : "text-muted-foreground"}
            >
              {riskLabel(item.risk_level)}
            </Badge>
          </div>
          {item.description && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{item.description}</p>}
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{planStatusLabel(item.status)}</span>
            {agent ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <ActorAvatar actorType="agent" actorId={agent.id} size={18} showStatusDot />
                <span className="truncate">{agent.name}</span>
              </span>
            ) : (
              <span>未分派</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, agent }: { message: TeamMessage; agent?: Agent }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        agent ? <ActorAvatar actorType="agent" actorId={agent.id} size={28} showStatusDot /> : <div className="flex size-7 items-center justify-center rounded-full bg-muted"><Bot className="size-4" /></div>
      )}
      <div className={cn("max-w-[82%] rounded-lg border px-3 py-2 text-sm leading-relaxed", isUser ? "bg-primary text-primary-foreground" : "bg-card")}>
        {!isUser && <div className="mb-1 text-xs font-medium text-muted-foreground">{agent?.name ?? "系统"}</div>}
        <div className="whitespace-pre-wrap">{message.content}</div>
        <div className={cn("mt-1 text-[10px]", isUser ? "text-primary-foreground/70" : "text-muted-foreground")}>{formatTime(message.created_at)}</div>
      </div>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "destructive";
}) {
  return (
    <div className={cn(
      "rounded-lg border bg-background px-4 py-3",
      tone === "warning" && "border-amber-500/30 bg-amber-500/10",
      tone === "destructive" && "border-destructive/30 bg-destructive/10",
    )}>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Capability({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium text-foreground">{value}</div>
    </div>
  );
}

function TimelineLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-background p-2">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function StackSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full rounded-md" />
      ))}
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">{text}</div>;
}
