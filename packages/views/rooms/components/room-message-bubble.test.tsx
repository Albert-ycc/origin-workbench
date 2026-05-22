import { render, screen } from "@testing-library/react";
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
  }: {
    actorType: string;
    actorId: string;
  }) => (
    <span
      data-testid="actor-avatar"
      data-actor-type={actorType}
      data-actor-id={actorId}
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
});
