import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Room } from "@multica/core/types";

const api = vi.hoisted(() => ({
  createRoom: vi.fn(),
  listAgents: vi.fn(),
  listRooms: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({ api }));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "ws-1", name: "Fairy", slug: "Fairy" }),
  useWorkspacePaths: () => ({
    roomDetail: (id: string) => `/Fairy/rooms/${id}`,
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
}));

vi.mock("@multica/views/common/actor-avatar", () => ({
  ActorAvatar: () => <span aria-hidden="true" />,
}));

import { RoomsPage } from "./rooms-page";

function createRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    workspace_id: "ws-1",
    name: "茶水间回归测试",
    description: "验证列表契约",
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
    name: "产品经理",
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
    owner_id: null,
    skills: [],
    created_at: "2026-05-21T00:00:00Z",
    updated_at: "2026-05-21T00:00:00Z",
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

function renderRoomsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RoomsPage />
    </QueryClientProvider>,
  );
}

describe("RoomsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listAgents.mockResolvedValue([]);
    api.listRooms.mockResolvedValue({ rooms: [], total: 0 });
    api.createRoom.mockResolvedValue(createRoom({ id: "room-created" }));
  });

  it("renders rooms from the backend envelope", async () => {
    api.listRooms.mockResolvedValue({
      rooms: [createRoom()],
      total: 1,
    });

    renderRoomsPage();

    expect(await screen.findByText("茶水间回归测试")).toBeInTheDocument();
    expect(screen.getByText("验证列表契约")).toBeInTheDocument();
  });

  it("marks the page with the current ambient theme", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 4, 22, 23, 30));
      const { container } = renderRoomsPage();

      expect(container.firstElementChild).toHaveAttribute("data-room-theme", "night");
    } finally {
      vi.useRealTimers();
    }
  });

  it("submits selected agents when creating a room", async () => {
    const user = userEvent.setup();
    api.listAgents.mockResolvedValue([createAgent()]);

    renderRoomsPage();

    await user.click(await screen.findByRole("button", { name: "新建第一个茶水间" }));
    await user.type(screen.getByPlaceholderText("给这个茶水间起个名字"), "新茶水间");
    await user.click(await screen.findByRole("button", { name: "产品经理" }));
    await user.click(screen.getByRole("button", { name: "创建茶水间" }));

    await waitFor(() => {
      expect(api.createRoom).toHaveBeenCalledWith({
        name: "新茶水间",
        description: undefined,
        agent_ids: ["agent-1"],
      });
    });
  });
});
