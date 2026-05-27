"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Gavel,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Send,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { DRAFT_NEW_SESSION, useChatStore } from "@multica/core/chat";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCreateMission } from "@multica/core/missions";
import { useCurrentWorkspace } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import {
  councilDetailOptions,
  councilListOptions,
  useAddCouncilParticipant,
  useAdjournCouncilSession,
  useArchiveCouncilSession,
  useCreateCouncilSession,
  useDeleteCouncilSession,
  useRemoveCouncilParticipant,
} from "@multica/core/councils";
import type {
  Agent,
  CouncilActivityLevel,
  CouncilSession,
  CouncilSessionMode,
  CouncilSessionParticipant,
  CreateMissionPlanItemRequest,
  CreateMissionRequest,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { PageHeader } from "../layout/page-header";
import { DragStrip } from "../platform";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";

export const councilProductCopy = {
  title: "多角色议事",
  detailTitle: "议事详情",
  createAction: "发起议事",
  listTitle: "议事列表",
  emptyTitle: "还没有多角色议事",
} as const;

export const councilDangerActions = ["归档", "删除"] as const;

export const councilDangerConfirmations = {
  councilDelete: "alert-dialog",
} as const;

export type CouncilRoundtableTemplateId = "brainstorm" | "review" | "decision";

type CouncilRoundtableTemplate = {
  id: CouncilRoundtableTemplateId;
  label: string;
  framework: string;
  expectedOutput: string;
  roleHints: string[];
  promptHint: string;
  missionPlan: Array<{
    title: string;
    phase: CreateMissionPlanItemRequest["phase"];
    description: string;
    priority: CreateMissionPlanItemRequest["priority"];
    riskLevel: CreateMissionPlanItemRequest["risk_level"];
  }>;
};

export const councilRoundtableTemplates = [
  {
    id: "brainstorm",
    label: "脑暴圆桌",
    framework: "双钻模型 + 六顶思考帽",
    expectedOutput: "可选方案、关键机会、主要盲点和下一步实验。",
    roleHints: ["机会发现者", "用户代表", "实现负责人", "风险预警员"],
    promptHint: "适合从模糊想法里拆出多个方向，再决定要不要升级为 Mission。",
    missionPlan: [
      {
        title: "收敛圆桌候选方案",
        phase: "plan",
        description: "把圆桌脑暴结果收敛为 1-3 个可执行方案，明确目标用户、场景和验收口径。",
        priority: "high",
        riskLevel: "low",
      },
      {
        title: "验证最高优先级方案",
        phase: "execute",
        description: "围绕优先方案补证据、拆实现路径，并标注需要用户拍板的关键假设。",
        priority: "high",
        riskLevel: "medium",
      },
      {
        title: "复核分歧和自我反驳",
        phase: "verify",
        description: "逐条检查圆桌中的反对意见、脆弱前提和未覆盖风险。",
        priority: "medium",
        riskLevel: "medium",
      },
      {
        title: "形成可交付方案",
        phase: "ship",
        description: "输出最终方案、行动项、后续 Mission 候选和项目记忆候选。",
        priority: "medium",
        riskLevel: "low",
      },
    ],
  },
  {
    id: "review",
    label: "评审圆桌",
    framework: "产品评审 + 技术评审 + QA 风险矩阵",
    expectedOutput: "问题清单、阻塞项、验收标准和是否通过的结论。",
    roleHints: ["产品经理", "架构师", "前端负责人", "后端负责人", "测试负责人"],
    promptHint: "适合 PRD、上线方案、交互方案和技术改造的多角色评审。",
    missionPlan: [
      {
        title: "整理评审阻塞项",
        phase: "plan",
        description: "把圆桌评审中的 P0/P1/P2 问题转为可执行清单，确认通过标准。",
        priority: "high",
        riskLevel: "medium",
      },
      {
        title: "修复 P0 与高风险 P1",
        phase: "execute",
        description: "优先处理会阻塞核心流程、造成数据错误或影响发布判断的问题。",
        priority: "high",
        riskLevel: "medium",
      },
      {
        title: "按验收矩阵回归",
        phase: "verify",
        description: "用圆桌定义的验收标准检查空态、错误态、边界、权限和核心路径。",
        priority: "high",
        riskLevel: "medium",
      },
      {
        title: "输出评审结论",
        phase: "ship",
        description: "沉淀最终通过/有条件通过/不通过结论、证据和剩余风险。",
        priority: "medium",
        riskLevel: "low",
      },
    ],
  },
  {
    id: "decision",
    label: "决策圆桌",
    framework: "正反辩论 + 第一性原理 + 决策备忘录",
    expectedOutput: "推荐选项、反对意见、成立条件、风险和拍板建议。",
    roleHints: ["主张方", "反对方", "风险官", "执行负责人"],
    promptHint: "适合路线取舍、是否投入、先做哪一刀、是否发布这类决策。",
    missionPlan: [
      {
        title: "写清决策备忘录",
        phase: "plan",
        description: "把推荐选项、放弃选项、成立条件和不可逆风险写成 Mission brief。",
        priority: "high",
        riskLevel: "medium",
      },
      {
        title: "执行已拍板方案",
        phase: "execute",
        description: "围绕被选方案做最小可验证实现，并保留决策证据。",
        priority: "high",
        riskLevel: "medium",
      },
      {
        title: "验证决策前提",
        phase: "verify",
        description: "检查关键假设是否仍成立，确认反对意见是否已被处理或接受。",
        priority: "high",
        riskLevel: "medium",
      },
      {
        title: "沉淀决策记录",
        phase: "ship",
        description: "把最终决策、理由、代价和后续动作写入项目记录。",
        priority: "medium",
        riskLevel: "low",
      },
    ],
  },
] satisfies CouncilRoundtableTemplate[];

const DEFAULT_ROUNDTABLE_TEMPLATE = councilRoundtableTemplates[0]!;

function roundtableTemplateById(id: CouncilRoundtableTemplateId): CouncilRoundtableTemplate {
  return councilRoundtableTemplates.find((template) => template.id === id) ?? DEFAULT_ROUNDTABLE_TEMPLATE;
}

export function buildRoundtableSummary({
  templateId,
  topic,
  expectedOutput,
  participantNames,
}: {
  templateId: CouncilRoundtableTemplateId;
  topic: string;
  expectedOutput?: string;
  participantNames: string[];
}) {
  const template = roundtableTemplateById(templateId);
  const output = expectedOutput?.trim() || template.expectedOutput;
  const names = participantNames.length > 0 ? participantNames.join("、") : "待选择";
  return [
    "[AI_ROUNDTABLE_P0]",
    `AI 圆桌类型：${template.label}`,
    `议题：${topic.trim()}`,
    `分析框架：${template.framework}`,
    `期望产出：${output}`,
    `参会角色：${names}`,
    "每位 Agent 输出：观点、证据、自我反驳、风险等级、建议动作",
    "主持人收束：结论、分歧、风险、假设、行动项、记忆候选",
  ].join("\n");
}

function isRoundtableSession(session: CouncilSession | null): boolean {
  return Boolean(session?.summary?.includes("[AI_ROUNDTABLE_P0]"));
}

function roundtableTemplateForSession(session: CouncilSession | null): CouncilRoundtableTemplate {
  if (!session?.summary) return DEFAULT_ROUNDTABLE_TEMPLATE;
  const matched = councilRoundtableTemplates.find((template) =>
    session.summary.includes(`AI 圆桌类型：${template.label}`),
  );
  return matched ?? DEFAULT_ROUNDTABLE_TEMPLATE;
}

function extractRoundtableLine(summary: string, label: string): string {
  const line = summary
    .split("\n")
    .find((item) => item.trim().startsWith(`${label}：`));
  return line ? line.replace(`${label}：`, "").trim() : "";
}

function activeParticipantAgentIds(participants: CouncilSessionParticipant[]) {
  return participants.filter((p) => !p.left_at).map((p) => p.agent_id);
}

function planItemsForRoundtable(
  template: CouncilRoundtableTemplate,
  captainId: string,
  memberIds: string[],
): CreateMissionPlanItemRequest[] {
  const assigneeFor = (index: number) => memberIds[index % Math.max(memberIds.length, 1)] ?? captainId;
  return template.missionPlan.map((item, index) => ({
    title: item.title,
    description: item.description,
    phase: item.phase,
    priority: item.priority,
    risk_level: item.riskLevel,
    assigned_agent_id: index === 0 ? captainId : assigneeFor(index - 1),
  }));
}

export function buildRoundtableMissionDraft(
  session: CouncilSession,
  participants: CouncilSessionParticipant[],
  agents: Agent[],
): CreateMissionRequest | null {
  const activeIds = activeParticipantAgentIds(participants);
  const captainId = activeIds[0];
  if (!captainId) return null;
  const memberIds = activeIds.slice(1);
  const template = roundtableTemplateForSession(session);
  const participantNames = activeIds.map((id) => agentNameById(agents, id));
  const summary = session.summary.trim();
  const conclusion = session.conclusion.trim();
  const source = conclusion || summary;
  return {
    title: `执行 AI 圆桌结论：${session.topic}`,
    prompt: [
      `基于 AI 圆桌「${session.topic}」创建 Mission。`,
      "",
      source,
      "",
      `参会角色：${participantNames.join("、") || "未记录"}`,
      "请把圆桌结论转成可执行计划，并在执行中持续核对分歧、风险和自我反驳。",
    ].join("\n"),
    summary,
    outcome: extractRoundtableLine(summary, "期望产出") || template.expectedOutput,
    project_id: session.project_id ?? undefined,
    captain_agent_id: captainId,
    member_agent_ids: memberIds,
    risk_level: "medium",
    execution_mode: "step_confirm",
    plan_items: planItemsForRoundtable(template, captainId, memberIds),
  };
}

export function closeCouncilAfterMutation({
  setSelectedId,
}: {
  setSelectedId: (id: string | null) => void;
}) {
  setSelectedId(null);
}

export function CouncilsPage() {
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();

  const sessionsQuery = useQuery(councilListOptions(wsId, "active"));
  const agentsQuery = useQuery(agentListOptions(wsId));
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((a) => !a.archived_at),
    [agentsQuery.data],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedSession = useMemo(
    () => (selectedId ? sessions.find((s) => s.id === selectedId) ?? null : null),
    [sessions, selectedId],
  );

  const detailQuery = useQuery({
    ...councilDetailOptions(wsId, selectedSession?.id ?? ""),
    enabled: !!selectedSession,
  });
  const participants = detailQuery.data?.participants ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <DragStrip />
      <PageHeader className="gap-1.5">
        <WorkspaceAvatar name={workspace?.name ?? "O"} size="sm" />
        <span className="text-sm text-muted-foreground">Origin</span>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="text-sm font-medium">{councilProductCopy.title}</span>
        {selectedSession ? (
          <>
            <ChevronRight className="size-3 text-muted-foreground" />
            <span className="text-sm font-medium">{councilProductCopy.detailTitle}</span>
          </>
        ) : null}
      </PageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {selectedSession ? (
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setSelectedId(null)}>
                  <ChevronLeft className="size-4" />
                  返回议事列表
                </Button>
                <h1 className="mt-1 line-clamp-2 text-lg font-semibold">{selectedSession.topic}</h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={selectedSession.status === "running" ? "default" : "secondary"}>
                  {labelForStatus(selectedSession.status)}
                </Badge>
                <Badge variant="outline">
                  {selectedSession.mode === "salon"
                    ? `沙龙 · ${selectedSession.max_turns} 轮`
                    : labelForActivity(selectedSession.activity_level)}
                </Badge>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
              <section className="flex flex-col gap-4">
                <SessionInteractionPanel
                  session={selectedSession}
                  participants={participants}
                  agents={agents}
                  loading={detailQuery.isLoading}
                />
              </section>

              <aside className="space-y-4">
                <SessionDetailPanel
                  session={selectedSession}
                  participants={participants}
                  agents={agents}
                  loading={detailQuery.isLoading}
                  onClearSelection={() => closeCouncilAfterMutation({ setSelectedId })}
                />
              </aside>
            </div>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
            <section className="flex flex-col gap-4">
              <div>
                <h1 className="text-lg font-semibold">{councilProductCopy.title}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  让多个 Agent 以不同角色围绕同一议题讨论，形成判断和下一步。
                </p>
              </div>
              <SessionsList
                sessions={sessions}
                loading={sessionsQuery.isLoading}
                selectedId={null}
                onSelect={setSelectedId}
              />
            </section>

            <aside className="order-first space-y-4 lg:order-none">
              <ConveneSession agents={agents} onCreated={setSelectedId} />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Convene
// ────────────────────────────────────────────────────────────────────────

function ConveneSession({
  agents,
  onCreated,
}: {
  agents: Agent[];
  onCreated?: (sessionId: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [activityLevel, setActivityLevel] = useState<CouncilActivityLevel>("concise");
  const [mode, setMode] = useState<CouncilSessionMode>("relay");
  const [roundtableTemplateId, setRoundtableTemplateId] =
    useState<CouncilRoundtableTemplateId>("brainstorm");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [maxTurns, setMaxTurns] = useState<number>(6);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const create = useCreateCouncilSession();

  const submit = async () => {
    const trimmed = topic.trim();
    if (!trimmed) return;
    if (mode === "salon" && selectedAgentIds.length < 2) {
      toast.error("沙龙至少需要 2 位陪伴 Agent");
      return;
    }
    if (mode === "relay" && selectedAgentIds.length < 2) {
      toast.error("AI 圆桌至少需要 2 位参会 Agent");
      return;
    }
    const participantNames = selectedAgentIds.map((id) => agentNameById(agents, id));
    try {
      const created = await create.mutateAsync({
        topic: trimmed,
        summary:
          mode === "relay"
            ? buildRoundtableSummary({
                templateId: roundtableTemplateId,
                topic: trimmed,
                expectedOutput,
                participantNames,
              })
            : undefined,
        activity_level: activityLevel,
        participant_agent_ids: selectedAgentIds,
        mode,
        max_turns: mode === "salon" ? maxTurns : undefined,
      });
      setTopic("");
      setExpectedOutput("");
      setSelectedAgentIds([]);
      onCreated?.(created.session.id);
      toast.success(mode === "salon" ? "沙龙已开张，Agent 即将轮流发言" : "AI 圆桌已发起");
    } catch (err) {
      toast.error("召开失败", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
    );
  };

  const isSalon = mode === "salon";

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Users className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold">{isSalon ? "开沙龙" : "发起 AI 圆桌"}</h2>
            <p className="text-sm text-muted-foreground">
              {isSalon
                ? "选几个 Agent 进来陪你聊。他们会自动轮流发言。"
                : "选择圆桌类型、议题和参会 Agent，形成可转 Mission 的结构化结论。"}
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">模式：</span>
          <Button
            size="sm"
            variant={mode === "relay" ? "default" : "outline"}
            onClick={() => setMode("relay")}
          >
            AI 圆桌
          </Button>
          <Button
            size="sm"
            variant={mode === "salon" ? "default" : "outline"}
            onClick={() => setMode("salon")}
          >
            沙龙客厅
          </Button>
        </div>

        <Textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={
            isSalon
              ? "随便说点什么开个场：今天好累 / 帮我吐槽下这事 / 想被夸夸…"
              : "议题：要让多个角色判断什么？"
          }
          rows={2}
        />

        {!isSalon ? (
          <div className="space-y-3">
            <div className="grid gap-2">
              <span className="text-xs text-muted-foreground">圆桌类型：</span>
              <div className="grid gap-2">
                {councilRoundtableTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setRoundtableTemplateId(template.id)}
                    className={cn(
                      "rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted/40",
                      roundtableTemplateId === template.id && "border-primary bg-primary/5",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{template.label}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {template.framework}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{template.promptHint}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <span className="text-xs text-muted-foreground">期望产出：</span>
              <Textarea
                value={expectedOutput}
                onChange={(e) => setExpectedOutput(e.target.value)}
                placeholder={roundtableTemplateById(roundtableTemplateId).expectedOutput}
                rows={2}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">节奏：</span>
              {(["quiet", "concise", "lively"] as const).map((lv) => (
                <Button
                  key={lv}
                  size="sm"
                  variant={activityLevel === lv ? "default" : "outline"}
                  onClick={() => setActivityLevel(lv)}
                >
                  {labelForActivity(lv)}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">轮数：</span>
            {[4, 6, 8, 12].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={maxTurns === n ? "default" : "outline"}
                onClick={() => setMaxTurns(n)}
              >
                {n} 轮
              </Button>
            ))}
          </div>
        )}

        <div>
          <div className="mb-2 text-xs text-muted-foreground">
            {isSalon ? "陪伴角色（至少 2 位）：" : "参会角色（至少 2 位）："}
          </div>
          <div className="flex flex-wrap gap-2">
            {agents.length === 0 ? (
              <span className="text-xs text-muted-foreground">还没有可选 Agent</span>
            ) : (
              agents.map((agent) => (
                <Button
                  key={agent.id}
                  size="sm"
                  variant={selectedAgentIds.includes(agent.id) ? "default" : "outline"}
                  onClick={() => toggleAgent(agent.id)}
                >
                  {agent.name}
                </Button>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={submit}
            disabled={!topic.trim() || create.isPending || selectedAgentIds.length < 2}
          >
            {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {isSalon ? "开张沙龙" : "发起 AI 圆桌"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function RoundtableWorkboard({
  session,
  participants,
  agents,
}: {
  session: CouncilSession;
  participants: CouncilSessionParticipant[];
  agents: Agent[];
}) {
  const template = roundtableTemplateForSession(session);
  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">AI 圆桌工作板</h2>
          <Badge variant="outline">{template.label}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          每个角色都需要给出观点、证据、自我反驳、风险等级和建议动作，避免多个 Agent 变成同一种平均答案。
        </p>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {participants.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            还没有参会 Agent。至少选择两位 Agent 才能形成圆桌视角。
          </div>
        ) : (
          participants.map((participant, index) => {
            const role = template.roleHints[index % template.roleHints.length] ?? "圆桌成员";
            const name = agentNameById(agents, participant.agent_id);
            return (
              <article key={participant.id} className="rounded-md border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-xs text-muted-foreground">{role}</div>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    待发言
                  </Badge>
                </div>
                <dl className="mt-3 grid gap-2 text-xs">
                  {["观点", "证据", "自我反驳", "风险等级", "建议动作"].map((label) => (
                    <div key={label} className="rounded border bg-muted/30 p-2">
                      <dt className="font-medium text-muted-foreground">{label}</dt>
                      <dd className="mt-1 text-muted-foreground">等待该角色在私聊/追问中补充。</dd>
                    </div>
                  ))}
                </dl>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// List
// ────────────────────────────────────────────────────────────────────────

function SessionsList({
  sessions,
  loading,
  selectedId,
  onSelect,
}: {
  sessions: CouncilSession[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </section>
    );
  }
  if (sessions.length === 0) {
    return (
      <section className="rounded-lg border bg-card p-8 text-center">
        <Users className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          {councilProductCopy.emptyTitle}。写一个议题、选几个 Agent 就能开始。
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-sm font-semibold">{councilProductCopy.listTitle}</h2>
        <Badge variant="outline">{sessions.length}</Badge>
      </div>
      <ul className="divide-y">
        {sessions.map((s) => (
          <li
            key={s.id}
            role="button"
            tabIndex={0}
            className={cn(
              "cursor-pointer p-4 transition-colors hover:bg-muted/40",
              selectedId === s.id && "bg-muted/60",
            )}
            onClick={() => onSelect(s.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(s.id);
              }
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.topic}</div>
                {s.summary ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.summary}</p>
                ) : null}
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={s.status === "running" ? "default" : "secondary"} className="text-[10px]">
                    {labelForStatus(s.status)}
                  </Badge>
                  {s.mode === "salon" ? (
                    <Badge variant="outline" className="text-[10px]">
                      沙龙 · {s.max_turns} 轮
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      {labelForActivity(s.activity_level)}
                    </Badge>
                  )}
                  <span className="ml-auto">{formatRelativeTime(s.updated_at)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 pt-0.5 text-xs font-medium text-muted-foreground">
                进入议事
                <ChevronRight className="size-3" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Interaction
// ────────────────────────────────────────────────────────────────────────

function SessionInteractionPanel({
  session,
  participants,
  agents,
  loading,
}: {
  session: CouncilSession | null;
  participants: CouncilSessionParticipant[];
  agents: Agent[];
  loading: boolean;
}) {
  const [draft, setDraft] = useState("");

  if (!session) {
    return (
      <section className="rounded-lg border bg-card p-6 text-center">
        <MessageSquareText className="mx-auto size-7 text-muted-foreground" />
        <h2 className="mt-3 text-sm font-semibold">私聊 / 追问</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          先发起一场多角色议事，然后在这里选择参与 Agent 私聊追问。
        </p>
      </section>
    );
  }

  const activeParticipants = participants.filter((p) => !p.left_at);
  const canSpeak = session.status === "running" && activeParticipants.length > 0;
  const openAgentChat = (agentId: string) => {
    const name = agentNameById(agents, agentId);
    openCouncilAgentChat(session, agentId, name, draft);
    setDraft("");
  };

  return (
    <>
      {isRoundtableSession(session) ? (
        <RoundtableWorkboard session={session} participants={activeParticipants} agents={agents} />
      ) : null}
      <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">私聊 / 追问</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            写一句要带进议事的话，再选择一个参与 Agent。消息会在 Direct Chat 中打开，带上当前 Council 上下文。
          </p>
        </div>
        <Badge variant={session.status === "running" ? "default" : "secondary"}>
          {labelForStatus(session.status)}
        </Badge>
      </div>
      <div className="space-y-3 p-4">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : activeParticipants.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            还没有参会 Agent。先在右侧加人，再开始私聊追问。
          </div>
        ) : (
          <>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="例如：请从产品、前端、测试三个角度判断这个方案有什么风险？"
              rows={3}
              disabled={!canSpeak}
            />
            <div className="flex flex-wrap gap-2">
              {activeParticipants.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant="outline"
                  disabled={!canSpeak}
                  onClick={() => openAgentChat(p.agent_id)}
                >
                  <Send className="size-3.5" />
                  私聊 {agentNameById(agents, p.agent_id)}
                </Button>
              ))}
            </div>
          </>
        )}
        {session.status !== "running" ? (
          <p className="text-xs text-muted-foreground">
            议事已结束，只保留归档、删除和结论查看。
          </p>
        ) : null}
      </div>
      </section>
    </>
  );
}

function RoundtableSummaryBox({ summary }: { summary: string }) {
  const rows = summary
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "[AI_ROUNDTABLE_P0]")
    .map((line) => {
      const [label, ...rest] = line.split("：");
      return { label, value: rest.join("：") || line };
    });
  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-2 text-xs">
      <div className="mb-2 font-semibold text-muted-foreground">AI 圆桌结构</div>
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={`${row.label}-${row.value}`} className="grid gap-0.5">
            <dt className="font-medium text-muted-foreground">{row.label}</dt>
            <dd className="whitespace-pre-wrap">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Detail
// ────────────────────────────────────────────────────────────────────────

function SessionDetailPanel({
  session,
  participants,
  agents,
  loading,
  onClearSelection,
}: {
  session: CouncilSession | null;
  participants: CouncilSessionParticipant[];
  agents: Agent[];
  loading: boolean;
  onClearSelection: () => void;
}) {
  const adjourn = useAdjournCouncilSession();
  const archive = useArchiveCouncilSession();
  const del = useDeleteCouncilSession();
  const addParticipant = useAddCouncilParticipant();
  const removeParticipant = useRemoveCouncilParticipant();
  const createMission = useCreateMission();

  const [conclusion, setConclusion] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!session) {
    return (
      <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        选一场多角色议事，这里看议题、参与角色和结论。
      </section>
    );
  }

  const activeParticipants = participants.filter((p) => !p.left_at);
  const availableAgents = agents.filter((a) => !activeParticipants.some((p) => p.agent_id === a.id));
  const roundtable = isRoundtableSession(session);
  const missionDraft = roundtable ? buildRoundtableMissionDraft(session, participants, agents) : null;

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <div className="text-sm font-semibold">{session.topic}</div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <Badge variant={session.status === "running" ? "default" : "secondary"}>
            {labelForStatus(session.status)}
          </Badge>
          <Badge variant="outline">{labelForActivity(session.activity_level)}</Badge>
        </div>
        {session.summary ? (
          roundtable ? (
            <RoundtableSummaryBox summary={session.summary} />
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{session.summary}</p>
          )
        ) : null}
        {session.conclusion ? (
          <div className="mt-3 rounded-md border bg-muted/40 p-2 text-xs">
            <div className="mb-1 font-semibold text-muted-foreground">议事结论</div>
            <p className="whitespace-pre-wrap">{session.conclusion}</p>
          </div>
        ) : null}
      </div>

      {roundtable ? (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs font-semibold text-muted-foreground">Mission 转换</div>
          <p className="mt-1 text-xs text-muted-foreground">
            把圆桌结论、分歧、自我反驳和行动项转成 Mission brief 与四阶段计划。
          </p>
          <Button
            size="sm"
            className="mt-3 w-full"
            disabled={!missionDraft || createMission.isPending}
            onClick={async () => {
              if (!missionDraft) {
                toast.error("至少需要一位参会 Agent 才能转 Mission");
                return;
              }
              try {
                const created = await createMission.mutateAsync(missionDraft);
                toast.success("Mission 已生成", {
                  description: created.mission.title,
                });
              } catch (err) {
                toast.error("生成 Mission 失败", { description: err instanceof Error ? err.message : String(err) });
              }
            }}
          >
            {createMission.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            转 Mission
          </Button>
        </div>
      ) : null}

      <div>
        <div className="mb-2 text-xs font-semibold text-muted-foreground">
          参与角色 ({activeParticipants.length})
        </div>
        {loading ? (
          <Skeleton className="h-8 w-full" />
        ) : activeParticipants.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有参与者，下方可以加。</p>
        ) : (
          <ul className="space-y-1">
            {activeParticipants.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border bg-background p-2 text-xs">
                <span className="flex items-center gap-2">
                  <CircleDot className="size-3" />
                  {agentNameById(agents, p.agent_id)}
                  {p.role === "convener" ? <Badge variant="outline" className="text-[10px]">召集人</Badge> : null}
                </span>
                {session.status === "running" ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        openCouncilAgentChat(
                          session,
                          p.agent_id,
                          agentNameById(agents, p.agent_id),
                        )
                      }
                    >
                      <MessageSquareText className="size-3" />
                      私聊
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await removeParticipant.mutateAsync({ sessionId: session.id, agentId: p.agent_id });
                        } catch (err) {
                          toast.error("移除失败", { description: err instanceof Error ? err.message : String(err) });
                        }
                      }}
                    >
                      <UserMinus className="size-3" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {session.status === "running" && availableAgents.length > 0 ? (
          <div className="mt-2">
            <div className="mb-1 text-xs text-muted-foreground">加人：</div>
            <div className="flex flex-wrap gap-1">
              {availableAgents.map((a) => (
                <Button
                  key={a.id}
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await addParticipant.mutateAsync({ sessionId: session.id, agent_id: a.id });
                    } catch (err) {
                      toast.error("加人失败", { description: err instanceof Error ? err.message : String(err) });
                    }
                  }}
                >
                  <UserPlus className="size-3" />
                  {a.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {session.status === "running" ? (
        <div className="border-t pt-3">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">结束议事</div>
          <Textarea
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            placeholder="可选：写一句话结论（共识 / 分歧 / 下一步）"
            rows={2}
          />
          <Button
            size="sm"
            variant="default"
            className="mt-2 w-full"
            disabled={adjourn.isPending}
            onClick={async () => {
              try {
                await adjourn.mutateAsync({ id: session.id, conclusion: conclusion.trim() || undefined });
                setConclusion("");
                toast.success("议事已结束");
              } catch (err) {
                toast.error("散会失败", { description: err instanceof Error ? err.message : String(err) });
              }
            }}
          >
            {adjourn.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Gavel className="size-3.5" />}
            结束议事
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end border-t pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
            <MoreHorizontal className="size-3.5" />
            更多
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              disabled={archive.isPending}
              onClick={async () => {
                try {
                  await archive.mutateAsync(session.id);
                  toast.success("已归档");
                  onClearSelection();
                } catch (err) {
                  toast.error("归档失败", { description: err instanceof Error ? err.message : String(err) });
                }
              }}
            >
              <Archive className="size-3.5" />
              归档
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={del.isPending}
            >
              <Trash2 className="size-3.5" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除多角色议事</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{session.topic}」后无法撤销，参与角色和结论记录也会一并移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={del.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                try {
                  await del.mutateAsync(session.id);
                  toast.success("已删除");
                  setDeleteOpen(false);
                  onClearSelection();
                } catch (err) {
                  toast.error("删除失败", { description: err instanceof Error ? err.message : String(err) });
                }
              }}
            >
              {del.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function labelForActivity(level: CouncilActivityLevel): string {
  switch (level) {
    case "quiet":
      return "静默";
    case "concise":
      return "精简";
    case "lively":
      return "活跃";
  }
}

function labelForStatus(status: CouncilSession["status"]): string {
  switch (status) {
    case "running":
      return "进行中";
    case "adjourned":
      return "已散会";
    case "archived":
      return "已归档";
  }
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString();
}

function agentNameById(agents: Agent[], id: string): string {
  return agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);
}

function openCouncilAgentChat(
  session: CouncilSession,
  agentId: string,
  agentName: string,
  userDraft = "",
) {
  const trimmedDraft = userDraft.trim();
  const roundtable = isRoundtableSession(session);
  const template = roundtableTemplateForSession(session);
  const prompt = [
    `多角色议事议题：${session.topic}`,
    roundtable ? `AI 圆桌类型：${template.label}` : "",
    roundtable ? `分析框架：${template.framework}` : "",
    roundtable ? "请按固定结构输出：观点、证据、自我反驳、风险等级、建议动作。" : "",
    "",
    `请以「${agentName}」身份参与这场 Council。`,
    trimmedDraft
      ? `我的发言：${trimmedDraft}`
      : "请先围绕这个议题给出你的判断、主要风险和下一步建议。",
  ].filter(Boolean).join("\n");

  const chat = useChatStore.getState();
  chat.setSelectedAgentId(agentId);
  chat.setActiveSession(null);
  chat.setInputDraft(DRAFT_NEW_SESSION, prompt);
  chat.setOpen(true);
  toast.success(`已打开 ${agentName} 的 Direct Chat`);
}
