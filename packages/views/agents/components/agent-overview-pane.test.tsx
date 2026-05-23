// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@multica/core/types";

vi.mock("./tabs/activity-tab", () => ({
  ActivityTab: () => <div>最近动态内容</div>,
}));

import { AgentOverviewPane } from "./agent-overview-pane";

const agent: Agent = {
  id: "agent-1",
  workspace_id: "ws-1",
  runtime_id: "",
  name: "产品经理",
  description: "",
  instructions: "",
  avatar_url: null,
  runtime_mode: "local",
  runtime_config: {},
  custom_env: {},
  custom_args: [],
  custom_env_redacted: false,
  visibility: "workspace",
  status: "idle",
  max_concurrent_tasks: 1,
  model: "",
  owner_id: "user-1",
  skills: [],
  created_at: "2026-04-16T00:00:00Z",
  updated_at: "2026-04-16T00:00:00Z",
  archived_at: null,
  archived_by: null,
};

describe("AgentOverviewPane", () => {
  it("uses single-concept top-level tabs instead of combined tabs", () => {
    render(
      <AgentOverviewPane
        agent={agent}
        runtimes={[]}
        members={[]}
        currentUserId="user-1"
        canEdit
        onUpdate={vi.fn()}
      />,
    );

    for (const label of [
      "概览",
      "工作记录",
      "模型",
      "运行环境",
      "指令",
      "技能",
      "记忆",
      "上下文",
      "环境变量",
      "自定义参数",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    for (const label of ["模型与运行环境", "指令与技能", "记忆与上下文", "高级配置"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });
});
