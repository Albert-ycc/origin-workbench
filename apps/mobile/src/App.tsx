import { FormEvent, useMemo, useState } from "react";
import {
  Bot,
  Inbox,
  Lightbulb,
  MonitorSmartphone,
  PlugZap,
  RefreshCw,
  Rocket,
  Settings2,
  Wifi,
} from "lucide-react";
import {
  AgentsPage,
  IdeasPage,
  InboxPage,
  MissionPage,
  WorkbenchPage,
} from "./features";
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
  createMobileMission,
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
  QuickInputDraft,
  RiskItem,
} from "./types";

type NavItem = {
  id: "workbench" | "mission" | "agent" | "ideas" | "inbox";
  label: string;
  icon: typeof MonitorSmartphone;
};

type ConnectionState = "demo" | "connecting" | "live" | "error";

const navItems: NavItem[] = [
  { id: "workbench", label: "工作台", icon: MonitorSmartphone },
  { id: "mission", label: "Mission", icon: Rocket },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "ideas", label: "想法", icon: Lightbulb },
  { id: "inbox", label: "信箱", icon: Inbox },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavItem["id"]>("workbench");
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
  const [selectedMissionId, setSelectedMissionId] = useState<string>(demoMissions[0]?.id ?? "");
  const [connectionState, setConnectionState] = useState<ConnectionState>("demo");
  const [statusMessage, setStatusMessage] = useState("当前使用本地演示数据；连接 Mac 后端后会切换到真实数据。");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const defaultApiBaseUrl = useMemo(() => getDefaultApiBaseUrl(), []);

  const liveReady = connectionState === "live" && Boolean(token && workspace);
  const selectedMission = missions.find((mission) => mission.id === selectedMissionId) ?? missions[0];

  async function connectToOrigin(nextWorkspaceId?: string | null) {
    setConnectionState("connecting");
    setStatusMessage("正在连接本机 Origin 后端...");

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
      setStatusMessage(snapshot.workspace
        ? `已连接 ${snapshot.workspace.name}，数据来自 ${apiBaseUrl}。`
        : "已登录，但后端还没有可用工作区。");
      setSettingsOpen(false);
    } catch (error) {
      setConnectionState("error");
      setStatusMessage(`${formatError(error)}；已保留本地演示数据。`);
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
      snapshot.missions.some((mission) => mission.id === current)
        ? current
        : snapshot.missions[0]?.id ?? demoMissions[0]?.id ?? "",
    );
  }

  async function refreshLiveData(message = "已刷新移动端数据。") {
    if (!token) return;
    const snapshot = await loadOriginSnapshot({
      baseUrl: apiBaseUrl,
      token,
      workspaceId: workspace?.id,
    });
    applySnapshot(snapshot);
    setStatusMessage(message);
  }

  function handleApiSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updated = setStoredApiBaseUrl(draftApiBaseUrl);
    setApiBaseUrl(updated);
    setDraftApiBaseUrl(updated);
    setStoredToken(null);
    setToken(null);
    setConnectionState("demo");
    setStatusMessage("API 地址已保存。点连接后会用这个地址重新登录。");
  }

  function handleApiReset() {
    const nextUrl = resetStoredApiBaseUrl();
    setApiBaseUrl(nextUrl);
    setDraftApiBaseUrl(nextUrl);
    setStatusMessage(`已恢复默认地址 ${nextUrl}。`);
  }

  async function handleWorkspaceChange(workspaceId: string) {
    setStoredWorkspaceId(workspaceId);
    await connectToOrigin(workspaceId);
  }

  function handleQuickSubmit(draft: QuickInputDraft) {
    void (async () => {
      if (liveReady && token && workspace) {
        const captainAgentId = agents[0]?.id;
        if (captainAgentId) {
          await createMobileMission({ baseUrl: apiBaseUrl, token, workspace, captainAgentId, draft });
          await refreshLiveData("Mission 已提交到本机 Origin。");
          setActiveTab("mission");
          return;
        }

        await createMobileIdea({
          baseUrl: apiBaseUrl,
          token,
          workspace,
          title: draft.title || "移动端输入",
          description: draft.context || "没有可用 Agent，已先收进想法池。",
        });
        await refreshLiveData("没有可用 Agent，已先保存到想法池。");
        setActiveTab("ideas");
        return;
      }

      const localMission = createLocalMission(draft);
      setMissions((current) => [localMission, ...current]);
      setSelectedMissionId(localMission.id);
      setActiveTab("mission");
      setStatusMessage("后端未连接，已先创建本地演示 Mission。");
    })().catch((error) => setStatusMessage(formatError(error)));
  }

  function handleCreateAgent(draft: AgentCreateDraft) {
    void (async () => {
      if (liveReady && token && workspace) {
        const runtimeId = runtimes.find((runtime) => runtime.status === "online")?.id ?? runtimes[0]?.id;
        if (!runtimeId) {
          setStatusMessage("后端已连接，但没有可用 runtime；先在桌面端启动本地 runtime 后再创建 Agent。");
          return;
        }
        await createMobileAgent({ baseUrl: apiBaseUrl, token, workspace, runtimeId, draft });
        await refreshLiveData("Agent 已创建。");
        return;
      }

      setAgents((current) => [createLocalAgent(draft), ...current]);
      setStatusMessage("后端未连接，已先创建本地演示 Agent。");
    })().catch((error) => setStatusMessage(formatError(error)));
  }

  function handleCaptureIdea(title: string) {
    void (async () => {
      if (liveReady && token && workspace) {
        await createMobileIdea({ baseUrl: apiBaseUrl, token, workspace, title });
        await refreshLiveData("想法已保存到 Origin 后端。");
        return;
      }

      setIdeas((current) => [createLocalIdea(title), ...current]);
      setStatusMessage("后端未连接，已先保存本地演示想法。");
    })().catch((error) => setStatusMessage(formatError(error)));
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
        await refreshLiveData("想法已升级为 Mission。");
        setActiveTab("mission");
        return;
      }

      const idea = ideas.find((item) => item.id === ideaId);
      if (!idea) return;
      const localMission = createLocalMission({ title: idea.title, context: idea.note });
      setMissions((current) => [localMission, ...current]);
      setSelectedMissionId(localMission.id);
      setActiveTab("mission");
      setStatusMessage("后端未连接，已把本地想法演示升级为 Mission。");
    })().catch((error) => setStatusMessage(formatError(error)));
  }

  function handleResolveInboxItem(itemId: string) {
    void (async () => {
      if (liveReady && token && workspace) {
        await markMobileInboxRead({ baseUrl: apiBaseUrl, token, workspace, itemId });
        await refreshLiveData("信箱条目已标记已读。");
        return;
      }

      setInboxItems((current) =>
        current.map((item) => item.id === itemId ? { ...item, status: "resolved" } : item),
      );
      setStatusMessage("已在本地演示数据中标记处理。");
    })().catch((error) => setStatusMessage(formatError(error)));
  }

  function renderActivePage() {
    if (activeTab === "mission") {
      return (
        <MissionPage
          mission={selectedMission}
          onAction={(actionId) => setStatusMessage(`移动端已收到 ${actionId} 操作；真实执行控制会在后续版本接入。`)}
          onSubmitContext={() => setStatusMessage("上下文补充入口已预留，后续会接 Mission 评论/事件流。")}
        />
      );
    }

    if (activeTab === "agent") {
      return <AgentsPage agents={agents} onCreateAgent={handleCreateAgent} />;
    }

    if (activeTab === "ideas") {
      return (
        <IdeasPage
          ideas={ideas}
          onCaptureIdea={handleCaptureIdea}
          onPromoteIdea={handlePromoteIdea}
        />
      );
    }

    if (activeTab === "inbox") {
      return (
        <InboxPage
          items={inboxItems}
          onResolveItem={handleResolveInboxItem}
          onOpenItem={(itemId) => setStatusMessage(`已打开信箱条目 ${itemId}。`)}
        />
      );
    }

    return (
      <WorkbenchPage
        missions={missions}
        risks={risks}
        onQuickSubmit={handleQuickSubmit}
        onOpenMission={(missionId) => {
          setSelectedMissionId(missionId);
          setActiveTab("mission");
        }}
        onOpenRisk={(riskId) => setStatusMessage(`已定位风险 ${riskId}。`)}
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
            <div>
              <p className="eyebrow">Origin Mobile</p>
              <h1>{workspace?.name ?? "本机工作台"}</h1>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="移动端连接设置"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <Settings2 size={20} />
          </button>
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
              <button type="button" className="secondary-button" onClick={() => void refreshLiveData()}>
                <RefreshCw size={16} />
                刷新
              </button>
              <button className="text-button" type="button" onClick={handleApiReset}>
                恢复默认
              </button>
            </div>
          </section>
        ) : null}

        <div className="status-strip" aria-live="polite">
          <Wifi size={15} />
          <span>{statusMessage}</span>
        </div>

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
                onClick={() => setActiveTab(item.id)}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </section>
    </main>
  );
}

function createLocalMission(draft: QuickInputDraft): Mission {
  const id = `local-mission-${Date.now()}`;
  return {
    id,
    title: draft.title || "移动端 Mission",
    summary: draft.context || "从移动端快速输入创建的本地演示任务。",
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
        description: draft.context || draft.title || "已创建移动端任务。",
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
