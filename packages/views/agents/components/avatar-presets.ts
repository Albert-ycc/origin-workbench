import { LORELEI_AVATAR_URLS } from "./lorelei-avatars";

/**
 * Built-in agent avatar presets — DiceBear Lorelei (CC0) hand-drawn line
 * portraits. Used by both the create-agent dialog and the agent-detail
 * inspector so the same 12 visuals appear wherever an agent's avatar can
 * be picked.
 */
export const AVATAR_PRESETS = [
  {
    id: "lorelei-lead",
    label: "团队负责人",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.teamLead,
  },
  {
    id: "lorelei-builder",
    label: "工程师",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.builder,
  },
  {
    id: "lorelei-researcher",
    label: "研究员",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.researcher,
  },
  {
    id: "lorelei-architect",
    label: "架构师",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.architect,
  },
  {
    id: "lorelei-ops",
    label: "运营",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.ops,
  },
  {
    id: "lorelei-analyst",
    label: "分析师",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.analyst,
  },
  {
    id: "lorelei-reviewer",
    label: "评审",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.reviewer,
  },
  {
    id: "lorelei-qa",
    label: "测试",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.qa,
  },
  {
    id: "lorelei-planner",
    label: "规划师",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.planner,
  },
  {
    id: "lorelei-design",
    label: "设计师",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.designer,
  },
  {
    id: "lorelei-product",
    label: "产品经理",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.product,
  },
  {
    id: "lorelei-support",
    label: "助理",
    style: "洛蕾莱",
    url: LORELEI_AVATAR_URLS.support,
  },
] as const;

export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
