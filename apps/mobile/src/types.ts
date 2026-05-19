export type OriginPriority = "low" | "medium" | "high" | "critical";

export type MissionStatus = "running" | "waiting" | "paused" | "done" | "blocked";

export type MissionTimelineStatus = "done" | "running" | "waiting" | "blocked";

export type AgentStatus = "idle" | "working" | "offline";

export type InboxItemType = "risk" | "confirmation" | "result";

export type InboxItemStatus = "unread" | "pending" | "resolved";

export interface QuickInputDraft {
  title: string;
  context: string;
}

export interface RiskItem {
  id: string;
  title: string;
  description: string;
  priority: OriginPriority;
  source: string;
  dueLabel?: string;
}

export interface MissionTimelineItem {
  id: string;
  title: string;
  description: string;
  timeLabel: string;
  status: MissionTimelineStatus;
}

export interface MissionAction {
  id: "pause" | "resume" | "abort";
  label: string;
  intent: "neutral" | "primary" | "danger";
}

export interface Mission {
  id: string;
  title: string;
  summary: string;
  ownerAgentId: string;
  status: MissionStatus;
  progress: number;
  startedAtLabel: string;
  etaLabel: string;
  currentStep: string;
  contextRequest?: string;
  timeline: MissionTimelineItem[];
  risks: RiskItem[];
}

export interface AgentCapability {
  id: string;
  label: string;
}

export interface OriginAgent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  currentMission?: string;
  workloadLabel: string;
  capabilities: AgentCapability[];
}

export interface AgentCreateDraft {
  name: string;
  role: string;
  capabilityText: string;
}

export interface IdeaItem {
  id: string;
  title: string;
  note: string;
  capturedAtLabel: string;
  tags: string[];
  readiness: "raw" | "scoped" | "ready";
}

export interface InboxItem {
  id: string;
  type: InboxItemType;
  status: InboxItemStatus;
  title: string;
  description: string;
  source: string;
  timeLabel: string;
  priority?: OriginPriority;
}
