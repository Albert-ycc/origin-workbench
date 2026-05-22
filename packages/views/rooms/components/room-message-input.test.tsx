import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, RoomMember, RoomMessage } from "@multica/core/types";

const api = vi.hoisted(() => ({
  listAgents: vi.fn(),
  listRoomMembers: vi.fn(),
}));

const mutate = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", () => ({ api }));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/rooms", async () => {
  const actual = await vi.importActual<typeof import("@multica/core/rooms")>(
    "@multica/core/rooms",
  );
  return {
    ...actual,
    useSendRoomMessage: () => ({
      isPending: false,
      mutate,
    }),
  };
});

vi.mock("@multica/views/common/actor-avatar", () => ({
  ActorAvatar: ({ actorId }: { actorId: string }) => (
    <span data-testid="actor-avatar" data-actor-id={actorId} />
  ),
}));

import { RoomMessageInput } from "./room-message-input";

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    runtime_id: "runtime-1",
    name: "前端开发工程师",
    description: "负责前端体验",
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
    agent_id: "agent-1",
    role: "participant",
    joined_at: "2026-05-21T00:00:00Z",
    left_at: null,
    ...overrides,
  };
}

function createMessage(overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id: "message-1",
    room_id: "room-1",
    sender_type: "agent",
    sender_id: "agent-1",
    sender_name: "产品经理",
    content: "先把用户问题说清楚。",
    is_autonomous: false,
    created_at: "2026-05-21T00:00:00Z",
    ...overrides,
  };
}

function renderInput(props: Partial<React.ComponentProps<typeof RoomMessageInput>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RoomMessageInput roomId="room-1" {...props} />
    </QueryClientProvider>,
  );
}

describe("RoomMessageInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listAgents.mockResolvedValue([createAgent()]);
    api.listRoomMembers.mockResolvedValue({ members: [createMember()] });
  });

  it("inserts selected room member mentions and sends the mentioned agent id", async () => {
    const user = userEvent.setup();

    renderInput();

    await user.type(screen.getByPlaceholderText(/输入 @ 提及成员/), "@");
    await user.click(await screen.findByRole("option", { name: /前端开发工程师/ }));
    await user.type(screen.getByPlaceholderText(/输入 @ 提及成员/), " 你看一下");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        {
          content: "@前端开发工程师  你看一下",
          mentions: ["agent-1"],
          mention_agent_ids: ["agent-1"],
        },
        expect.any(Object),
      );
    });
  });

  it("sends the quoted message id and shows a cancelable quote preview", async () => {
    const user = userEvent.setup();
    const onCancelReply = vi.fn();

    renderInput({
      replyToMessage: createMessage(),
      onCancelReply,
    });

    expect(screen.getByText("引用 产品经理")).toBeInTheDocument();
    expect(screen.getByText("先把用户问题说清楚。")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/输入 @ 提及成员/), "继续说");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        {
          content: "继续说",
          reply_to_message_id: "message-1",
        },
        expect.any(Object),
      );
    });

    await user.click(screen.getByRole("button", { name: "取消引用" }));
    expect(onCancelReply).toHaveBeenCalled();
  });
});
