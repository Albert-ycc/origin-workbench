// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@multica/core/types";

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/agents", () => ({
  agentMemoryKeys: {
    detail: (workspaceId: string, agentId: string) => [
      "agent-memory",
      workspaceId,
      agentId,
    ],
  },
  summarizeActivityWindow: () => ({ totalRuns: 3 }),
  useWorkspaceActivityMap: () => ({
    byAgent: new Map([
      [
        "agent-1",
        {
          buckets: [
            { total: 1, failed: 0 },
            { total: 2, failed: 0 },
          ],
        },
      ],
    ]),
  }),
}));

vi.mock("@multica/core/autopilots/queries", () => ({
  autopilotListOptions: () => ({
    queryKey: ["autopilots", "ws-1"],
    queryFn: async () => [],
  }),
}));

import { JournalTab } from "./journal-tab";

const agent: Agent = {
  id: "agent-1",
  workspace_id: "ws-1",
  runtime_id: "runtime-1",
  name: "Agent",
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

function renderJournalTab() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <JournalTab agent={agent} />
    </QueryClientProvider>,
  );
}

describe("JournalTab", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the work record overview without redundant inner tabs", () => {
    renderJournalTab();

    expect(screen.getByText("数据周期")).toBeInTheDocument();
    expect(screen.getByText("已完成任务")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "工作记录" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "时间视图" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "任务历史" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "触发器" }),
    ).not.toBeInTheDocument();
  });

  it("switches the calendar period between year and month only", async () => {
    renderJournalTab();

    expect(screen.getByRole("button", { name: "年" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("年工作记录日历")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "月" }));
    expect(screen.getByRole("button", { name: "月" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("2026年5月工作记录日历")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "周" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("周工作记录日历")).not.toBeInTheDocument();
  });

  it("renders month mode as a real month calendar", async () => {
    renderJournalTab();

    fireEvent.click(screen.getByRole("button", { name: "月" }));

    const calendar = screen.getByLabelText("2026年5月工作记录日历");
    expect(calendar).toBeInTheDocument();
    for (const label of ["日", "一", "二", "三", "四", "五", "六"]) {
      expect(within(calendar).getByText(label)).toBeInTheDocument();
    }
    expect(within(calendar).getByLabelText("2026-05-23，今天")).toBeInTheDocument();
  });
});
