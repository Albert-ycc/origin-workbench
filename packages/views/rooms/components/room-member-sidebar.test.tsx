import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, RoomMember } from "@multica/core/types";

const api = vi.hoisted(() => ({
  listAgents: vi.fn(),
  listRoomMembers: vi.fn(),
  removeRoomMember: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({ api }));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/views/common/actor-avatar", () => ({
  ActorAvatar: () => <span aria-hidden="true" />,
}));

import { RoomMemberSidebar } from "./room-member-sidebar";

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    runtime_id: "runtime-1",
    name: "前端开发工程师",
    description: "",
    instructions: "",
    avatar_url: null,
    runtime_mode: "cloud",
    runtime_config: {},
    custom_env: {},
    custom_args: [],
    custom_env_redacted: false,
    visibility: "workspace",
    status: "idle",
    max_concurrent_tasks: 1,
    model: "",
    work_mode: "live",
    mailbox_budget_seconds: 0,
    notify_policy: "on_complete",
    owner_id: null,
    skills: [],
    created_at: "2026-05-21T00:00:00Z",
    updated_at: "2026-05-21T00:00:00Z",
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

function createMember(overrides: Partial<RoomMember> = {}): RoomMember {
  return {
    id: "member-1",
    room_id: "room-1",
    member_type: "agent",
    member_id: "agent-1",
    role: "participant",
    joined_at: "2026-05-21T00:00:00Z",
    left_at: null,
    ...overrides,
  };
}

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RoomMemberSidebar roomId="room-1" />
    </QueryClientProvider>,
  );
}

describe("RoomMemberSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listAgents.mockResolvedValue([createAgent()]);
    api.listRoomMembers.mockResolvedValue({ members: [createMember()] });
    api.removeRoomMember.mockResolvedValue(undefined);
  });

  it("renders agent members using their display names", async () => {
    renderSidebar();

    expect(await screen.findByText("前端开发工程师")).toBeInTheDocument();
    expect(screen.queryByText("agent-1")).not.toBeInTheDocument();
  });

  it("lets users remove an agent member from the room", async () => {
    const user = userEvent.setup();

    renderSidebar();

    await user.click(await screen.findByRole("button", { name: "移除前端开发工程师" }));

    await waitFor(() => {
      expect(api.removeRoomMember).toHaveBeenCalledWith("room-1", "agent-1");
    });
  });
});
