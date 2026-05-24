import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RoomMessage } from "@multica/core/types";

vi.mock("@multica/core/rooms", () => ({
  useRoomsStore: (selector: (state: { chunkBuffer: Map<string, string> }) => unknown) =>
    selector({ chunkBuffer: new Map() }),
}));

vi.mock("@multica/views/common/actor-avatar", () => ({
  ActorAvatar: ({
    actorType,
    actorId,
    className,
  }: {
    actorType: string;
    actorId: string;
    className?: string;
  }) => (
    <span
      data-testid="actor-avatar"
      data-actor-type={actorType}
      data-actor-id={actorId}
      data-class-name={className ?? ""}
    />
  ),
}));

vi.mock("@multica/views/common/markdown", () => ({
  Markdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { RoomMessageBubble } from "./room-message-bubble";

function createMessage(overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id: "message-1",
    room_id: "room-1",
    sender_type: "agent",
    sender_id: "agent-1",
    sender_name: "前端开发工程师",
    content: "我来看看这个交互。",
    is_autonomous: false,
    created_at: "2026-05-21T00:00:00Z",
    ...overrides,
  };
}

describe("RoomMessageBubble", () => {
  it("renders agent messages with the sender avatar", () => {
    render(<RoomMessageBubble message={createMessage()} />);

    const avatar = screen.getByTestId("actor-avatar");
    expect(avatar).toHaveAttribute("data-actor-type", "agent");
    expect(avatar).toHaveAttribute("data-actor-id", "agent-1");
    expect(screen.getByText("前端开发工程师")).toBeInTheDocument();
    expect(screen.getByText("我来看看这个交互。")).toBeInTheDocument();
  });

  it("keeps the status dot anchored to the avatar instead of the row spacing", () => {
    render(<RoomMessageBubble message={createMessage()} />);

    const avatar = screen.getByTestId("actor-avatar");
    expect(avatar.parentElement).toHaveClass("mt-0.5");
    expect(avatar).toHaveAttribute("data-class-name", "rounded-full");
  });

  it("lets users quote an agent message", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();

    render(<RoomMessageBubble message={createMessage()} onReply={onReply} />);

    await user.click(screen.getByRole("button", { name: "引用前端开发工程师的消息" }));

    expect(onReply).toHaveBeenCalledWith(createMessage());
  });

  it("renders the quoted message preview above a reply", () => {
    render(
      <RoomMessageBubble
        message={createMessage({
          sender_type: "user",
          sender_name: "我",
          sender_id: "user-1",
          content: "收到，我继续追问。",
          reply_to_message_id: "message-0",
        })}
        replyToMessage={createMessage({
          id: "message-0",
          sender_name: "产品经理",
          content: "先把问题说清楚。",
        })}
      />,
    );

    expect(screen.getByText("引用 产品经理")).toBeInTheDocument();
    expect(screen.getByText("先把问题说清楚。")).toBeInTheDocument();
    expect(screen.getByText("收到，我继续追问。")).toBeInTheDocument();
  });
});
