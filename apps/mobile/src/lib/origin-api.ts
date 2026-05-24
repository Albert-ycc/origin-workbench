import { ApiClient, ApiError } from "@multica/core/api/client";
import { setCurrentWorkspace } from "@multica/core/platform";
import type {
  Agent as CoreAgent,
  AgentRuntime,
  Idea as CoreIdea,
  InboxItem as CoreInboxItem,
  Mission as CoreMission,
  Workspace,
} from "@multica/core/types";
import type {
  AgentCreateDraft,
  IdeaItem,
  InboxItem,
  Mission,
  MissionTimelineItem,
  OriginAgent,
  QuickInputDraft,
  RiskItem,
} from "../types";

const TOKEN_STORAGE_KEY = "origin_mobile_auth_token";
const WORKSPACE_STORAGE_KEY = "origin_mobile_workspace_id";
const LOCAL_USER_NAME = "Albert Mobile";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
}

export interface RuntimeSummary {
  id: string;
  name: string;
  status: AgentRuntime["status"];
}

export interface OriginSnapshot {
  token: string;
  userName: string;
  workspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  runtimes: RuntimeSummary[];
  agents: OriginAgent[];
  missions: Mission[];
  ideas: IdeaItem[];
  inboxItems: InboxItem[];
  risks: RiskItem[];
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getStoredWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
}

export function setStoredWorkspaceId(workspaceId: string | null) {
  if (typeof window === "undefined") return;
  if (workspaceId) {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
  } else {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  }
}

export function createMobileApiClient(baseUrl: string, token: string | null) {
  const client = new ApiClient(baseUrl, {
    identity: {
      platform: "mobile",
      version: "1.1.1",
      os: getClientOS(),
    },
  });
  client.setToken(token);
  return client;
}

export async function loadOriginSnapshot(params: {
  baseUrl: string;
  token: string | null;
  workspaceId?: string | null;
}): Promise<OriginSnapshot> {
  const auth = await ensureSignedIn(params.baseUrl, params.token);
  const workspaces = auth.workspaces.map(mapWorkspace);
  const workspace =
    pickWorkspace(auth.workspaces, params.workspaceId ? params.workspaceId : getStoredWorkspaceId()) ??
    auth.workspaces[0] ??
    null;

  if (!workspace) {
    setCurrentWorkspace(null, null);
    return {
      token: auth.token,
      userName: auth.userName,
      workspace: null,
      workspaces,
      runtimes: [],
      agents: [],
      missions: [],
      ideas: [],
      inboxItems: [],
      risks: [],
    };
  }

  setCurrentWorkspace(workspace.slug, workspace.id);
  setStoredWorkspaceId(workspace.id);

  const [agentsResult, missionsResult, ideasResult, inboxResult, runtimesResult] =
    await Promise.allSettled([
      auth.client.listAgents({ workspace_id: workspace.id }),
      auth.client.listMissions("active"),
      auth.client.listIdeas("active"),
      auth.client.listInbox(),
      auth.client.listRuntimes({ workspace_id: workspace.id, owner: "me" }),
    ]);

  const coreAgents = settledValue(agentsResult, []);
  const coreMissions = settledValue(missionsResult, { missions: [], total: 0 }).missions;
  const coreIdeas = settledValue(ideasResult, { ideas: [], total: 0 }).ideas;
  const coreInboxItems = settledValue(inboxResult, []);
  const coreRuntimes = settledValue(runtimesResult, []);

  const missions = coreMissions.map(mapMission);
  const inboxItems = coreInboxItems.map(mapInboxItem);

  return {
    token: auth.token,
    userName: auth.userName,
    workspace: mapWorkspace(workspace),
    workspaces,
    runtimes: coreRuntimes.map(mapRuntime),
    agents: coreAgents.map(mapAgent),
    missions,
    ideas: coreIdeas.map(mapIdea),
    inboxItems,
    risks: deriveRisks(missions, inboxItems),
  };
}

export async function createMobileMission(params: {
  baseUrl: string;
  token: string;
  workspace: WorkspaceSummary;
  captainAgentId: string;
  draft: QuickInputDraft;
}) {
  const client = scopedClient(params.baseUrl, params.token, params.workspace);
  const title = params.draft.title.trim() || firstLine(params.draft.context) || "移动端 Mission";
  const context = params.draft.context.trim();
  await client.createMission({
    title,
    prompt: [title, context].filter(Boolean).join("\n\n"),
    summary: context || title,
    captain_agent_id: params.captainAgentId,
    risk_level: "medium",
    execution_mode: "confirm",
  });
}

export async function createMobileIdea(params: {
  baseUrl: string;
  token: string;
  workspace: WorkspaceSummary;
  title: string;
  description?: string;
}) {
  const client = scopedClient(params.baseUrl, params.token, params.workspace);
  await client.createIdea({
    title: params.title,
    description: params.description ?? "来自 Origin Mobile 的快速捕捉。",
    source: "manual",
    tags: ["mobile"],
  });
}

export async function createMobileVoiceIdea(params: {
  baseUrl: string;
  token: string;
  workspace: WorkspaceSummary;
  blob: Blob;
  durationSeconds: number;
  filename: string;
}) {
  const client = scopedClient(params.baseUrl, params.token, params.workspace);
  const file = new File([params.blob], params.filename, { type: params.blob.type || "audio/webm" });
  const attachment = await client.uploadFile(file);
  const seconds = Math.max(1, Math.round(params.durationSeconds));
  const capturedAt = new Date().toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const title = `🎙️ ${seconds} 秒语音 · ${capturedAt}`;
  const description = [
    "[voice-note]",
    `url: ${attachment.url}`,
    `duration: ${seconds}s`,
    `content_type: ${attachment.content_type ?? params.blob.type}`,
    `size_bytes: ${attachment.size_bytes ?? params.blob.size}`,
    "captured_from: origin-mobile",
  ].join("\n");
  await client.createIdea({
    title,
    description,
    source: "manual",
    tags: ["mobile", "voice"],
  });
}

export async function promoteMobileIdea(params: {
  baseUrl: string;
  token: string;
  workspace: WorkspaceSummary;
  ideaId: string;
  captainAgentId: string;
}) {
  const client = scopedClient(params.baseUrl, params.token, params.workspace);
  await client.promoteIdea(params.ideaId, {
    captain_agent_id: params.captainAgentId,
    risk_level: "medium",
    execution_mode: "confirm",
  });
}

export async function markMobileInboxRead(params: {
  baseUrl: string;
  token: string;
  workspace: WorkspaceSummary;
  itemId: string;
}) {
  const client = scopedClient(params.baseUrl, params.token, params.workspace);
  await client.markInboxRead(params.itemId);
}

export async function createMobileAgent(params: {
  baseUrl: string;
  token: string;
  workspace: WorkspaceSummary;
  runtimeId: string;
  draft: AgentCreateDraft;
}) {
  const client = scopedClient(params.baseUrl, params.token, params.workspace);
  await client.createAgent({
    name: params.draft.name,
    description: params.draft.role,
    instructions: params.draft.capabilityText || params.draft.role,
    runtime_id: params.runtimeId,
    visibility: "workspace",
    max_concurrent_tasks: 3,
  });
}

function scopedClient(baseUrl: string, token: string, workspace: WorkspaceSummary) {
  setCurrentWorkspace(workspace.slug, workspace.id);
  return createMobileApiClient(baseUrl, token);
}

async function ensureSignedIn(baseUrl: string, token: string | null) {
  const client = createMobileApiClient(baseUrl, token);
  if (token) {
    try {
      const workspaces = await client.listWorkspaces();
      return { client, token, userName: LOCAL_USER_NAME, workspaces };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
  }

  const login = await client.localSignIn(LOCAL_USER_NAME);
  client.setToken(login.token);
  const workspaces = await client.listWorkspaces();
  return { client, token: login.token, userName: login.user.name, workspaces };
}

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function pickWorkspace(workspaces: Workspace[], preferredId?: string | null): Workspace | null {
  if (!preferredId) return null;
  return workspaces.find((workspace) => workspace.id === preferredId) ?? null;
}

function mapWorkspace(workspace: Workspace): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
  };
}

function mapRuntime(runtime: AgentRuntime): RuntimeSummary {
  return {
    id: runtime.id,
    name: runtime.name,
    status: runtime.status,
  };
}

function mapAgent(agent: CoreAgent): OriginAgent {
  const capabilities = [
    agent.runtime_mode,
    agent.model,
    ...agent.skills.slice(0, 3).map((skill) => skill.name),
  ].filter(Boolean);

  return {
    id: agent.id,
    name: agent.name,
    role: agent.description || agent.instructions || "本地协作 Agent",
    status: mapAgentStatus(agent.status),
    currentMission: agent.status === "working" ? "正在处理任务" : undefined,
    workloadLabel: `${agent.max_concurrent_tasks} 并发上限`,
    capabilities: capabilities.map((label) => ({
      id: `${agent.id}-${label}`,
      label,
    })),
  };
}

function mapAgentStatus(status: CoreAgent["status"]): OriginAgent["status"] {
  if (status === "working" || status === "blocked") return "working";
  if (status === "offline" || status === "error") return "offline";
  return "idle";
}

function mapMission(mission: CoreMission): Mission {
  const timeline: MissionTimelineItem[] = [
    {
      id: `${mission.id}-created`,
      title: "Mission 创建",
      description: mission.prompt || mission.summary || "已创建执行任务。",
      timeLabel: formatTimeLabel(mission.created_at),
      status: "done",
    },
    {
      id: `${mission.id}-current`,
      title: statusTitle(mission.status),
      description: mission.outcome || mission.summary || "等待 Agent 更新执行结果。",
      timeLabel: formatTimeLabel(mission.updated_at),
      status: mapTimelineStatus(mission.status),
    },
  ];

  return {
    id: mission.id,
    title: mission.title || firstLine(mission.prompt) || "未命名 Mission",
    summary: mission.summary || mission.prompt || "暂无摘要",
    ownerAgentId: mission.captain_agent_id,
    status: mapMissionStatus(mission.status),
    progress: missionProgress(mission.status),
    startedAtLabel: formatTimeLabel(mission.created_at),
    etaLabel: mission.status === "completed" ? "已完成" : "待更新",
    currentStep: statusTitle(mission.status),
    contextRequest: mission.status === "waiting_confirmation" ? "Agent 正在等待你确认下一步。" : undefined,
    timeline,
    risks: mission.risk_level === "high" || mission.status === "blocked"
      ? [
          {
            id: `${mission.id}-risk`,
            title: mission.status === "blocked" ? "Mission 已受阻" : "高风险 Mission",
            description: mission.summary || mission.prompt || "需要移动端确认风险处理口径。",
            priority: mission.status === "blocked" ? "critical" : "high",
            source: mission.title,
          },
        ]
      : [],
  };
}

function mapMissionStatus(status: CoreMission["status"]): Mission["status"] {
  if (status === "executing" || status === "planning") return "running";
  if (status === "waiting_confirmation" || status === "draft") return "waiting";
  if (status === "blocked") return "blocked";
  if (status === "completed" || status === "archived") return "done";
  return "waiting";
}

function mapTimelineStatus(status: CoreMission["status"]): MissionTimelineItem["status"] {
  if (status === "completed" || status === "archived") return "done";
  if (status === "blocked") return "blocked";
  if (status === "executing" || status === "planning") return "running";
  return "waiting";
}

function missionProgress(status: CoreMission["status"]): number {
  if (status === "completed" || status === "archived") return 100;
  if (status === "executing") return 62;
  if (status === "planning") return 32;
  if (status === "blocked") return 48;
  return 14;
}

function statusTitle(status: CoreMission["status"]): string {
  const titles: Record<CoreMission["status"], string> = {
    draft: "等待编排",
    planning: "正在拆解计划",
    waiting_confirmation: "等待确认",
    executing: "正在执行",
    blocked: "执行受阻",
    completed: "执行完成",
    archived: "已归档",
  };
  return titles[status];
}

function mapIdea(idea: CoreIdea): IdeaItem {
  return {
    id: idea.id,
    title: idea.title || "未命名想法",
    note: idea.description || "暂无补充说明",
    capturedAtLabel: formatTimeLabel(idea.created_at),
    tags: idea.tags.length > 0 ? idea.tags : ["mobile"],
    readiness: idea.status === "promoted" ? "ready" : idea.status === "nurturing" ? "scoped" : "raw",
  };
}

function mapInboxItem(item: CoreInboxItem): InboxItem {
  return {
    id: item.id,
    type: mapInboxType(item),
    status: item.archived || item.read ? "resolved" : item.severity === "action_required" ? "pending" : "unread",
    title: item.title,
    description: item.body || "无补充说明",
    source: item.actor_type ?? "system",
    timeLabel: formatTimeLabel(item.created_at),
    priority: item.severity === "action_required" ? "high" : item.severity === "attention" ? "medium" : undefined,
  };
}

function mapInboxType(item: CoreInboxItem): InboxItem["type"] {
  if (item.type.includes("failed") || item.type.includes("blocked")) return "risk";
  if (item.type.includes("requested") || item.type.includes("assigned")) return "confirmation";
  return "result";
}

function deriveRisks(missions: Mission[], inboxItems: InboxItem[]): RiskItem[] {
  const missionRisks = missions.flatMap((mission) => mission.risks);
  const inboxRisks = inboxItems
    .filter((item) => item.type === "risk" || item.status === "pending")
    .slice(0, 4)
    .map<RiskItem>((item) => ({
      id: `inbox-risk-${item.id}`,
      title: item.title,
      description: item.description,
      priority: item.priority ?? "medium",
      source: item.source,
      dueLabel: item.timeLabel,
    }));
  return [...missionRisks, ...inboxRisks].slice(0, 6);
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/).find(Boolean)?.slice(0, 48) ?? "";
}

function formatTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getClientOS(): string {
  if (typeof navigator === "undefined") return "unknown";
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return "ios";
  if (/Android/.test(navigator.userAgent)) return "android";
  if (/Mac/.test(navigator.userAgent)) return "macos";
  return "web";
}
