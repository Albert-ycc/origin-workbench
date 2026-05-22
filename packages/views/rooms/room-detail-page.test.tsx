import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Room } from "@multica/core/types";

const api = vi.hoisted(() => ({
  addRoomMember: vi.fn(),
  deleteRoom: vi.fn(),
  getRoom: vi.fn(),
  listAgents: vi.fn(),
  listRoomMembers: vi.fn(),
  listRoomMessages: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({ api }));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    rooms: () => "/Fairy/rooms",
  }),
}));

vi.mock("../navigation", () => ({
  AppLink: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useNavigation: () => ({ push: vi.fn() }),
}));

vi.mock("@multica/views/common/actor-avatar", () => ({
  ActorAvatar: () => <span aria-hidden="true" />,
}));

import { RoomDetailPage } from "./room-detail-page";

function createRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    workspace_id: "ws-1",
    name: "茶水间详情",
    description: "可继续邀请成员",
    archived_at: null,
    created_at: "2026-05-21T00:00:00Z",
    updated_at: "2026-05-21T00:00:00Z",
    ...overrides,
  };
}

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    runtime_id: "runtime-1",
    name: "体验测试员",
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

function renderRoomDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RoomDetailPage roomId="room-1" />
    </QueryClientProvider>,
  );
}

describe("RoomDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getRoom.mockResolvedValue(createRoom());
    api.listAgents.mockResolvedValue([createAgent()]);
    api.listRoomMembers.mockResolvedValue({ members: [] });
    api.listRoomMessages.mockResolvedValue({ messages: [] });
    api.deleteRoom.mockResolvedValue(undefined);
    api.addRoomMember.mockResolvedValue({
      id: "member-1",
      room_id: "room-1",
      member_type: "agent",
      member_id: "agent-1",
      agent_id: "agent-1",
      role: "participant",
      joined_at: "2026-05-21T00:00:00Z",
      left_at: null,
    });
  });

  it("lets users add an agent member after the room is created", async () => {
    const user = userEvent.setup();

    renderRoomDetail();

    await user.click(await screen.findByRole("button", { name: "+ 邀请" }));
    await user.click(await screen.findByRole("button", { name: /体验测试员/ }));
    await user.click(screen.getByRole("button", { name: /加入/ }));

    await waitFor(() => {
      expect(api.addRoomMember).toHaveBeenCalledWith("room-1", {
        member_type: "agent",
        member_id: "agent-1",
        role: "participant",
      });
    });
  });

  it("lets users select multiple agents before joining the room", async () => {
    const user = userEvent.setup();
    api.listAgents.mockResolvedValue([
      createAgent({ id: "agent-1", name: "体验测试员" }),
      createAgent({ id: "agent-2", name: "前端开发工程师" }),
    ]);

    renderRoomDetail();

    await user.click(await screen.findByRole("button", { name: "+ 邀请" }));
    await user.click(await screen.findByRole("button", { name: /体验测试员/ }));
    await user.click(await screen.findByRole("button", { name: /前端开发工程师/ }));
    await user.click(screen.getByRole("button", { name: /加入/ }));

    await waitFor(() => {
      expect(api.addRoomMember).toHaveBeenCalledTimes(2);
    });
    expect(api.addRoomMember).toHaveBeenNthCalledWith(1, "room-1", {
      member_type: "agent",
      member_id: "agent-1",
      role: "participant",
    });
    expect(api.addRoomMember).toHaveBeenNthCalledWith(2, "room-1", {
      member_type: "agent",
      member_id: "agent-2",
      role: "participant",
    });
  });

  it("lets users delete the current room", async () => {
    const user = userEvent.setup();

    renderRoomDetail();

    await user.click(await screen.findByRole("button", { name: "删除茶水间" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(api.deleteRoom).toHaveBeenCalledWith("room-1");
    });
  });
});
