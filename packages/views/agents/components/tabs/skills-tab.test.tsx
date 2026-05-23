// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Agent, Skill } from "@multica/core/types";

const mockListSkills = vi.hoisted(() => vi.fn());
const mockSetAgentSkills = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/api", () => ({
  api: {
    listSkills: (...args: unknown[]) => mockListSkills(...args),
    setAgentSkills: (...args: unknown[]) => mockSetAgentSkills(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { SkillsTab } from "./skills-tab";

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

function skill(id: string, name: string): Skill {
  return {
    id,
    workspace_id: "ws-1",
    name,
    description: "",
    content: "",
    config: {},
    files: [],
    created_by: null,
    created_at: "2026-04-16T00:00:00Z",
    updated_at: "2026-04-16T00:00:00Z",
  };
}

function renderSkillsTab(overrides?: Partial<Agent>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SkillsTab agent={{ ...agent, ...overrides }} />
    </QueryClientProvider>,
  );
}

describe("SkillsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSkills.mockResolvedValue([]);
  });

  it("does not render the inline Local Runtime Skills section even for local-runtime agents", async () => {
    // The inline section auto-loaded local skills on every Skills-tab
    // entry, which was both noisy and (under multi-replica deploys) prone
    // to "request not found" because the request store is in-process.
    // Local-skill import now lives behind the explicit Skills page →
    // Add Skill → From Runtime tab; nothing here may auto-load.
    renderSkillsTab();

    // Top informational callout should still render; that's how we know
    // the tab body itself rendered (not stuck in a loading state).
    expect(
      await screen.findByText(/本地运行环境里的技能会自动可用/),
    ).toBeInTheDocument();

    // The removed section's heading and its trigger button must be gone.
    expect(screen.queryByText("本地运行环境技能")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /导入到工作区/i }),
    ).not.toBeInTheDocument();

    // No runtime list / local-skills query should be wired up either —
    // we removed @multica/core/runtimes from this file's imports.
    // Surface it via behaviour: the `agent` here has runtime_id but the
    // tab must not invoke any runtime-list mock to render. (Both are
    // already deleted from the mock setup above; this assertion is
    // implicit — the test file would fail to import if the component
    // still referenced runtimeListOptions / runtimeLocalSkillsOptions.)
  });

  it("adds multiple selected skills in one assignment update", async () => {
    const user = userEvent.setup();
    mockListSkills.mockResolvedValue([
      skill("skill-1", "需求拆解"),
      skill("skill-2", "测试设计"),
      skill("skill-3", "周报整理"),
    ]);
    mockSetAgentSkills.mockResolvedValue(undefined);

    renderSkillsTab();

    await user.click(await screen.findByRole("button", { name: "批量添加技能" }));
    await user.click(await screen.findByRole("button", { name: /需求拆解/ }));
    await user.click(await screen.findByRole("button", { name: /测试设计/ }));
    await user.click(screen.getByRole("button", { name: "添加选中的 2 项" }));

    expect(mockSetAgentSkills).toHaveBeenCalledWith("agent-1", {
      skill_ids: ["skill-1", "skill-2"],
    });
  });

  it("can select all available skills in the batch add dialog", async () => {
    const user = userEvent.setup();
    mockListSkills.mockResolvedValue([
      skill("skill-1", "需求拆解"),
      skill("skill-2", "测试设计"),
      skill("skill-3", "周报整理"),
    ]);
    mockSetAgentSkills.mockResolvedValue(undefined);

    renderSkillsTab();

    await user.click(await screen.findByRole("button", { name: "批量添加技能" }));
    await user.click(screen.getByRole("button", { name: "全选" }));
    await user.click(screen.getByRole("button", { name: "添加选中的 3 项" }));

    expect(mockSetAgentSkills).toHaveBeenCalledWith("agent-1", {
      skill_ids: ["skill-1", "skill-2", "skill-3"],
    });
  });
});
