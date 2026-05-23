import type { IdeaItem, InboxItem, Mission, OriginAgent, RiskItem } from "../types";

export const demoRisks: RiskItem[] = [
  {
    id: "risk-runtime-access",
    title: "需要确认本地 runtime 权限",
    description: "Mission 需要读取桌面项目目录，当前只拿到只读上下文。",
    priority: "high",
    source: "前端 Agent",
    dueLabel: "今天",
  },
  {
    id: "risk-copywriting",
    title: "发布文案可能涉及公开仓库口径",
    description: "README 与应用内说明需要保持 Origin / multica 命名边界一致。",
    priority: "medium",
    source: "产品检查",
  },
];

export const demoMissions: Mission[] = [
  {
    id: "mission-mobile-v01",
    title: "Origin Mobile v1.1 页面骨架",
    summary: "补齐移动端核心页面，先让 App.tsx 能集成可演示的工作流。",
    ownerAgentId: "agent-frontend-b",
    status: "running",
    progress: 62,
    startedAtLabel: "09:20",
    etaLabel: "约 35 分钟",
    currentStep: "整理页面组件与本地 demo 数据",
    contextRequest: "请确认 v0.1 是否只需要移动 Web 适配，还是要预留原生容器手势。",
    risks: demoRisks,
    timeline: [
      {
        id: "timeline-1",
        title: "识别页面范围",
        description: "工作台、Mission、Agent、想法池、信箱五个入口已确认。",
        timeLabel: "09:24",
        status: "done",
      },
      {
        id: "timeline-2",
        title: "组件拆分",
        description: "页面使用本地数据和 props 双模式，避免强依赖后端联通。",
        timeLabel: "09:48",
        status: "running",
      },
      {
        id: "timeline-3",
        title: "交给 App.tsx 集成",
        description: "导出页面组件，后续由主路由或底部 Tab 接入。",
        timeLabel: "待执行",
        status: "waiting",
      },
    ],
  },
  {
    id: "mission-release-check",
    title: "桌面发布前风险巡检",
    summary: "检查版本号、图标资源和 release 配置是否满足正式发版。",
    ownerAgentId: "agent-release",
    status: "waiting",
    progress: 28,
    startedAtLabel: "昨天",
    etaLabel: "等待确认",
    currentStep: "等待是否进入打包验证",
    risks: [],
    timeline: [
      {
        id: "timeline-release-1",
        title: "收集待检项",
        description: "已列出 semver、应用名、图标和 GitHub Release 几类检查。",
        timeLabel: "昨天",
        status: "done",
      },
      {
        id: "timeline-release-2",
        title: "等待授权",
        description: "需要明确是否允许执行本机打包命令。",
        timeLabel: "现在",
        status: "waiting",
      },
    ],
  },
];

export const demoAgents: OriginAgent[] = [
  {
    id: "agent-frontend-b",
    name: "前端 Agent B",
    role: "移动页面组件",
    status: "working",
    currentMission: "Origin Mobile v1.1 页面骨架",
    workloadLabel: "2 个任务",
    capabilities: [
      { id: "cap-react", label: "React" },
      { id: "cap-mobile", label: "移动端 UI" },
      { id: "cap-typescript", label: "TypeScript" },
    ],
  },
  {
    id: "agent-release",
    name: "发布 Agent",
    role: "版本与打包",
    status: "idle",
    workloadLabel: "待命",
    capabilities: [
      { id: "cap-ci", label: "CI" },
      { id: "cap-electron", label: "Electron" },
    ],
  },
  {
    id: "agent-reviewer",
    name: "审查 Agent",
    role: "风险与需求评审",
    status: "idle",
    workloadLabel: "1 个待确认",
    capabilities: [
      { id: "cap-review", label: "评审" },
      { id: "cap-doc", label: "文档" },
    ],
  },
];

export const demoIdeas: IdeaItem[] = [
  {
    id: "idea-quick-mission",
    title: "一键把聊天意图升级成 Mission",
    note: "用户说“继续做”时自动补齐目标、范围、验收口径。",
    capturedAtLabel: "10 分钟前",
    tags: ["Mission", "效率"],
    readiness: "ready",
  },
  {
    id: "idea-risk-inbox",
    title: "把需要用户拍板的事项集中进信箱",
    note: "避免确认点散落在长对话里，移动端优先处理。",
    capturedAtLabel: "今天 08:50",
    tags: ["信箱", "确认"],
    readiness: "scoped",
  },
  {
    id: "idea-agent-avatar",
    title: "Agent 头像增加状态感",
    note: "工作中、等待中、离线用细节状态表达，不做大面积装饰。",
    capturedAtLabel: "昨天",
    tags: ["Agent"],
    readiness: "raw",
  },
];

export const demoInboxItems: InboxItem[] = [
  {
    id: "inbox-risk-1",
    type: "risk",
    status: "unread",
    title: "移动端入口尚未接入真实路由",
    description: "组件已可独立渲染，但需要 App.tsx 决定底部导航和默认首页。",
    source: "前端 Agent B",
    timeLabel: "刚刚",
    priority: "medium",
  },
  {
    id: "inbox-confirm-1",
    type: "confirmation",
    status: "pending",
    title: "是否允许 Mission 中断按钮直接暴露",
    description: "当前 UI 已加入二级视觉强度，后续可接确认弹窗。",
    source: "Mission",
    timeLabel: "12 分钟前",
    priority: "high",
  },
  {
    id: "inbox-result-1",
    type: "result",
    status: "resolved",
    title: "Agent 列表 demo 数据已就绪",
    description: "包含工作中、待命、评审三类 Agent 状态。",
    source: "Agent",
    timeLabel: "今天 09:42",
  },
];
