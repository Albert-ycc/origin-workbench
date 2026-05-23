import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Inbox,
  Lightbulb,
  MonitorSmartphone,
  PlugZap,
  RefreshCw,
  Rocket,
  Settings2,
  X,
} from "lucide-react";
import { AgentsPage, IdeasPage, InboxPage, MissionPage } from "./features";
import {
  demoAgents,
  demoIdeas,
  demoInboxItems,
  demoMissions,
  demoRisks,
} from "./fixtures/mobile-demo-data";
import {
  createMobileAgent,
  createMobileIdea,
  createMobileVoiceIdea,
  getStoredToken,
  getStoredWorkspaceId,
  loadOriginSnapshot,
  markMobileInboxRead,
  promoteMobileIdea,
  setStoredToken,
  setStoredWorkspaceId,
  type OriginSnapshot,
  type RuntimeSummary,
  type WorkspaceSummary,
} from "./lib/origin-api";
import {
  getDefaultApiBaseUrl,
  getStoredApiBaseUrl,
  resetStoredApiBaseUrl,
  setStoredApiBaseUrl,
} from "./lib/api-config";
import type {
  AgentCreateDraft,
  IdeaItem,
  InboxItem,
  Mission,
  OriginAgent,
  RiskItem,
} from "./types";

type TabId = "mission" | "inbox" | "ideas";

type NavItem = {
  id: TabId;
  label: string;
  icon: typeof MonitorSmartphone;
};

type ConnectionState = "demo" | "connecting" | "live" | "error";

type ToastTone = "info" | "error";

const navItems: NavItem[] = [
  { id: "mission", label: "Mission", icon: Rocket },
  { id: "inbox", label: "信箱", icon: Inbox },
  { id: "ideas", label: "想法", icon: Lightbulb },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("mission");
  const [apiBaseUrl, setApiBaseUrl] = useState(() => getStoredApiBaseUrl());
  const [draftApiBaseUrl, setDraftApiBaseUrl] = useState(apiBaseUrl);
  const [token, setToken] = useState(() => getStoredToken());
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeSummary[]>([]);
  const [missions, setMissions] = useState<Mission[]>(demoMissions);
  const [agents, setAgents] = useState<OriginAgent[]>(demoAgents);
  const [ideas, setIdeas] = useState<IdeaItem[]>(demoIdeas);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(demoInboxItems);
  const [risks, setRisks] = useState<RiskItem[]>(demoRisks);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("demo");
  const [settingsOpen, setSettingsOpen] = useState(() => !getStoredToken());
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const defaultApiBaseUrl = useMemo(() => getDefaultApiBaseUrl(), []);

  const liveReady = connectionState === "live" && Boolean(token && workspace);
  const selectedMission = selectedMissionId
    ? missions.find((mission) => mission.id === selectedMissionId)
    : undefined;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function showToast(message: string, tone: ToastTone = "info") {
    setToast({ message, tone });
  }

  async function connectToOrigin(nextWorkspaceId?: string | null) {
    setConnectionState("connecting");
    try {
      const snapshot = await loadOriginSnapshot({
        baseUrl: apiBaseUrl,
        token,
        workspaceId: nextWorkspaceId ?? getStoredWorkspaceId(),
      });
      applySnapshot(snapshot);
      setStoredToken(snapshot.token);
      setToken(snapshot.token);
      setConnectionState("live");
      showToast(
        snapshot.workspace
          ? `已连接 ${snapshot.workspace.name}`
          : "已登录，但后端还没有可用工作区",
      );
      setSettingsOpen(false);
    } catch (error) {
      setConnectionState("error");
      showToast(formatError(error), "error");
    }
  }

  function applySnapshot(snapshot: OriginSnapshot) {
    setWorkspace(snapshot.workspace);
    setWorkspaces(snapshot.workspaces);
    setRuntimes(snapshot.runtimes);
    setAgents(snapshot.agents.length > 0 ? snapshot.agents : demoAgents);
    setMissions(snapshot.missions.length > 0 ? snapshot.missions : demoMissions);
    setIdeas(snapshot.ideas.length > 0 ? snapshot.ideas : demoIdeas);
    setInboxItems(snapshot.inboxItems.length > 0 ? snapshot.inboxItems : demoInboxItems);
    setRisks(snapshot.risks.length > 0 ? snapshot.risks : demoRisks);
    setSelectedMissionId((current) =>
      current && snapshot.missions.some((mission) => mission.id === current) ? current : null,
    );
  }

  async function refreshLiveData(message?: string) {
    if (!token) return;
    const snapshot = await loadOriginSnapshot({
      baseUrl: apiBaseUrl,
      token,
      workspaceId: workspace?.id,
    });
    applySnapshot(snapshot);
    if (message) showToast(message);
  }

  function handleApiSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updated = setStoredApiBaseUrl(draftApiBaseUrl);
    setApiBaseUrl(updated);
    setDraftApiBaseUrl(updated);
    setStoredToken(null);
    setToken(null);
    setConnectionState("demo");
    showToast("API 地址已保存，点连接重新登录");
  }

  function handleApiReset() {
    const nextUrl = resetStoredApiBaseUrl();
    setApiBaseUrl(nextUrl);
    setDraftApiBaseUrl(nextUrl);
    showToast(`已恢复默认地址 ${nextUrl}`);
  }

  async function handleWorkspaceChange(workspaceId: string) {
    setStoredWorkspaceId(workspaceId);
    await connectToOrigin(workspaceId);
  }

  function handleCreateAgent(draft: AgentCreateDraft) {
    void (async () => {
      if (liveReady && token && workspace) {
        const runtimeId =
          runtimes.find((runtime) => runtime.status === "online")?.id ?? runtimes[0]?.id;
        if (!runtimeId) {
          showToast("没有可用 runtime，先在桌面端启动本地 runtime", "error");
          return;
        }
        await createMobileAgent({ baseUrl: apiBaseUrl, token, workspace, runtimeId, draft });
        await refreshLiveData("Agent 已创建");
        return;
      }
      setAgents((current) => [createLocalAgent(draft), ...current]);
      showToast("后端未连接，已创建本地演示 Agent");
    })().catch((error) => showToast(formatError(error), "error"));
  }

  function handleCaptureIdea(title: string) {
    void (async () => {
      if (liveReady && token && workspace) {
        await createMobileIdea({ baseUrl: apiBaseUrl, token, workspace, title });
        await refreshLiveData("想法已保存到 Origin");
        return;
      }
      setIdeas((current) => [createLocalIdea(title), ...current]);
      showToast("后端未连接，已保存本地演示想法");
    })().catch((error) => showToast(formatError(error), "error"));
  }

  async function handleSaveVoice(payload: {
    blob: Blob;
    durationSeconds: number;
    mimeType: string;
  }) {
    if (!(liveReady && token && workspace)) {
      throw new Error("后端未连接，无法上传录音");
    }
    const ext = extensionForMime(payload.mimeType);
    const filename = `mobile-voice-${Date.now()}.${ext}`;
    await createMobileVoiceIdea({
      baseUrl: apiBaseUrl,
      token,
      workspace,
      blob: payload.blob,
      durationSeconds: payload.durationSeconds,
      filename,
    });
    await refreshLiveData("语音想法已保存到 Origin");
  }

  function handlePromoteIdea(ideaId: string) {
    void (async () => {
      if (liveReady && token && workspace && agents[0]) {
        await promoteMobileIdea({
          baseUrl: apiBaseUrl,
          token,
          workspace,
          ideaId,
          captainAgentId: agents[0].id,
        });
        await refreshLiveData("想法已升级为 Mission");
        setSelectedMissionId(null);
        setActiveTab("mission");
        return;
      }

      const idea = ideas.find((item) => item.id === ideaId);
      if (!idea) return;
      const localMission = createLocalMission(idea.title, idea.note);
      setMissions((current) => [localMission, ...current]);
      setSelectedMissionId(null);
      setActiveTab("mission");
      showToast("后端未连接，已本地升级 Mission");
    })().catch((error) => showToast(formatError(error), "error"));
  }

  function handleResolveInboxItem(itemId: string) {
    void (async () => {
      if (liveReady && token && workspace) {
        await markMobileInboxRead({ baseUrl: apiBaseUrl, token, workspace, itemId });
        await refreshLiveData("信箱条目已标记已读");
        return;
      }

      setInboxItems((current) =>
        current.map((item) => (item.id === itemId ? { ...item, status: "resolved" } : item)),
      );
      showToast("已在本地演示数据中标记处理");
    })().catch((error) => showToast(formatError(error), "error"));
  }

  function renderActivePage() {
    if (activeTab === "mission") {
      return (
        <MissionPage
          missions={missions}
          selectedMission={selectedMission}
          risks={risks}
          onOpenMission={(id) => setSelectedMissionId(id)}
          onBackToList={() => setSelectedMissionId(null)}
          onOpenRisk={(riskId) => showToast(`已定位风险 ${riskId}`)}
          onAction={(actionId) => showToast(`收到 ${actionId} 操作；执行控制由桌面端处理`)}
          onSubmitContext={() => showToast("补充上下文入口预留，后续接入 Mission 评论流")}
        />
      );
    }

    if (activeTab === "inbox") {
      return (
        <InboxPage
          items={inboxItems}
          onResolveItem={handleResolveInboxItem}
          onOpenItem={(itemId) => showToast(`已打开信箱条目 ${itemId}`)}
        />
      );
    }

    return (
      <IdeasPage
        ideas={ideas}
        onCaptureIdea={handleCaptureIdea}
        onPromoteIdea={handlePromoteIdea}
        onSaveVoice={liveReady ? handleSaveVoice : undefined}
        voiceEnabled={liveReady}
      />
    );
  }

  return (
    <main className="app-shell dark">
      <section className="mobile-frame" aria-label="Origin Mobile">
        <header className="top-bar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <MonitorSmartphone size={18} />
            </span>
            <div className="brand-text">
              <h1>{workspace?.name ?? "未连接"}</h1>
              <p className="brand-meta">
                {liveReady ? `Origin Mobile · ${apiBaseUrl.replace(/^https?:\/\//, "")}` : "Origin Mobile · 本地演示"}
              </p>
            </div>
          </div>
          <div className="top-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="查看 Agent"
              onClick={() => setAgentsOpen(true)}
            >
              <Bot size={20} />
            </button>
            <button
              className={`icon-button settings-button settings-${connectionState}`}
              type="button"
              aria-label="移动端连接设置"
              onClick={() => setSettingsOpen((value) => !value)}
            >
              <Settings2 size={20} />
              <span className="settings-dot" aria-hidden="true" />
            </button>
          </div>
        </header>

        {settingsOpen ? (
          <section className="connection-panel" aria-label="后端连接">
            <div className="connection-heading">
              <span className={`status-dot status-dot-${connectionState}`} aria-hidden="true" />
              <div>
                <p>本机 Origin 后端</p>
                <strong>{apiBaseUrl}</strong>
              </div>
            </div>

            <form className="api-form" onSubmit={handleApiSubmit}>
              <label htmlFor="api-base-url">Mac 局域网 API 地址</label>
              <div className="api-row">
                <input
                  id="api-base-url"
                  value={draftApiBaseUrl}
                  onChange={(event) => setDraftApiBaseUrl(event.target.value)}
                  placeholder={defaultApiBaseUrl}
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <button type="submit">保存</button>
              </div>
            </form>

            {workspaces.length > 1 ? (
              <label className="workspace-picker" htmlFor="workspace">
                <span>工作区</span>
                <select
                  id="workspace"
                  value={workspace?.id ?? ""}
                  onChange={(event) => void handleWorkspaceChange(event.target.value)}
                >
                  {workspaces.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="connection-actions">
              <button
                type="button"
                className="primary-button"
                disabled={connectionState === "connecting"}
                onClick={() => void connectToOrigin()}
              >
                <PlugZap size={16} />
                {connectionState === "connecting" ? "连接中" : "连接"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void refreshLiveData("已刷新移动端数据")}
              >
                <RefreshCw size={16} />
                刷新
              </button>
              <button className="text-button" type="button" onClick={handleApiReset}>
                恢复默认
              </button>
            </div>
          </section>
        ) : null}

        {toast ? (
          <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
            <span>{toast.message}</span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setToast(null)}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}

        <section className="tab-viewport" aria-label="移动端页面">
          {renderActivePage()}
        </section>

        <nav className="bottom-nav" aria-label="底部导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const selected = activeTab === item.id;
            return (
              <button
                className={selected ? "nav-item nav-item-active" : "nav-item"}
                key={item.id}
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id === "mission") setSelectedMissionId(null);
                }}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {agentsOpen ? (
          <div className="drawer-backdrop" onClick={() => setAgentsOpen(false)}>
            <div
              className="drawer-sheet"
              role="dialog"
              aria-label="Agent 抽屉"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="drawer-close"
                aria-label="关闭 Agent 抽屉"
                onClick={() => setAgentsOpen(false)}
              >
                <X size={18} />
              </button>
              <div className="drawer-body">
                <AgentsPage agents={agents} onCreateAgent={handleCreateAgent} />
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function createLocalMission(title: string, context?: string): Mission {
  const id = `local-mission-${Date.now()}`;
  return {
    id,
    title: title || "移动端 Mission",
    summary: context || "从移动端快速输入创建的本地演示任务。",
    ownerAgentId: "local-mobile-agent",
    status: "running",
    progress: 18,
    startedAtLabel: "刚刚",
    etaLabel: "待估算",
    currentStep: "等待接入本机后端",
    risks: [],
    timeline: [
      {
        id: `${id}-created`,
        title: "移动端捕捉",
        description: context || title || "已创建移动端任务。",
        timeLabel: "刚刚",
        status: "running",
      },
    ],
  };
}

function createLocalIdea(title: string): IdeaItem {
  return {
    id: `local-idea-${Date.now()}`,
    title,
    note: "从移动端临时保存，连接后端后可写入真实想法池。",
    capturedAtLabel: "刚刚",
    tags: ["mobile"],
    readiness: "raw",
  };
}

function createLocalAgent(draft: AgentCreateDraft): OriginAgent {
  const capabilities = draft.capabilityText
    .split(/[，,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    id: `local-agent-${Date.now()}`,
    name: draft.name,
    role: draft.role,
    status: "idle",
    workloadLabel: "本地演示",
    capabilities: (capabilities.length > 0 ? capabilities : ["mobile"]).map((label) => ({
      id: `${draft.name}-${label}`,
      label,
    })),
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "连接失败";
}

function extensionForMime(mimeType: string): string {
  if (mimeType.startsWith("audio/webm")) return "webm";
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  if (mimeType.startsWith("audio/aac")) return "aac";
  if (mimeType.startsWith("audio/ogg")) return "ogg";
  return "webm";
}
