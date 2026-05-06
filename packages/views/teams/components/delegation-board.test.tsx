import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { teamKeys } from "@multica/core/teams";
import type {
  DelegationTaskCard,
  Issue,
  TimelineEntry,
} from "@multica/core/types";

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/realtime", () => ({
  useWSEvent: vi.fn(),
  useWSReconnect: vi.fn(),
}));

vi.mock("@multica/ui/components/ui/sheet", () => ({
  Sheet: ({ children, open }: any) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: ({ actorType, actorId }: any) => (
    <span data-testid="actor-avatar">
      {actorType}:{actorId}
    </span>
  ),
}));

vi.mock("../../common/markdown", () => ({
  Markdown: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const mockApiObj = vi.hoisted(() => ({
  listDelegationTaskCards: vi.fn(),
  getIssue: vi.fn(),
  listTimeline: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  listIssueReactions: vi.fn().mockResolvedValue([]),
  addCommentReaction: vi.fn(),
  removeCommentReaction: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({
  api: mockApiObj,
  getApi: () => mockApiObj,
  setApiInstance: vi.fn(),
}));

const mockCards: DelegationTaskCard[] = [
  {
    issue_id: "issue-1",
    issue_key: "FAI-12",
    workspace_id: "ws-1",
    number: 12,
    title: "Summarize onboarding blockers",
    status: "in_review",
    assignee_id: "agent-1",
    assignee_name: "Codex Local",
    assignee_avatar_url: null,
    source_team_message_id: "message-1",
    source_team_session_id: "team-1",
    project_id: null,
    latest_result_preview: "Long execution result is ready for review",
    latest_result_comment_id: "comment-1",
    comment_count: 2,
    updated_at: "2026-05-06T00:00:00Z",
  },
];

const mockIssue: Issue = {
  id: "issue-1",
  workspace_id: "ws-1",
  number: 12,
  identifier: "FAI-12",
  title: "Summarize onboarding blockers",
  description: "Read the team chat and report blockers.",
  status: "in_review",
  priority: "medium",
  assignee_type: "agent",
  assignee_id: "agent-1",
  creator_type: "member",
  creator_id: "user-1",
  parent_issue_id: null,
  project_id: null,
  position: 0,
  due_date: null,
  created_at: "2026-05-06T00:00:00Z",
  updated_at: "2026-05-06T00:00:00Z",
};

const mockTimeline: TimelineEntry[] = [
  {
    type: "comment",
    id: "comment-1",
    actor_type: "agent",
    actor_id: "agent-1",
    content: "Detailed execution result with enough context for the drawer.",
    parent_id: null,
    created_at: "2026-05-06T00:01:00Z",
    updated_at: "2026-05-06T00:01:00Z",
    comment_type: "comment",
  },
];

import { DelegationBoard } from "./delegation-board";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderDelegationBoard() {
  const queryClient = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <DelegationBoard messageId="message-1" userId="user-1" />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("DelegationBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiObj.listDelegationTaskCards.mockResolvedValue({
      cards: mockCards,
      total: mockCards.length,
    });
    mockApiObj.getIssue.mockResolvedValue(mockIssue);
    mockApiObj.listTimeline.mockResolvedValue(mockTimeline);
    mockApiObj.createComment.mockResolvedValue({
      id: "comment-new",
      issue_id: "issue-1",
      author_type: "member",
      author_id: "user-1",
      content: "Follow up",
      parent_id: null,
      type: "comment",
      created_at: "2026-05-06T00:02:00Z",
      updated_at: "2026-05-06T00:02:00Z",
    });
  });

  it("opens task details with timeline output from a compact row", async () => {
    renderDelegationBoard();

    await waitFor(() => {
      expect(screen.getByText("派出的任务 · 1 张")).toBeInTheDocument();
    });

    expect(screen.getByText("Codex Local")).toBeInTheDocument();
    expect(screen.getByText("FAI-12")).toBeInTheDocument();
    expect(screen.getByText("Summarize onboarding blockers")).toBeInTheDocument();
    expect(
      screen.getByText("Long execution result is ready for review"),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-05-06 00:00")).toBeInTheDocument();
    expect(screen.getByText("2 条评论")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /FAI-12/ }));

    await waitFor(() => {
      expect(screen.getByTestId("sheet")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getByText("Read the team chat and report blockers."),
      ).toBeInTheDocument();
    });
    expect(
      await screen.findByText(
        "Detailed execution result with enough context for the drawer.",
      ),
    ).toBeInTheDocument();
  });

  it("does not render when delegation cards are empty", async () => {
    mockApiObj.listDelegationTaskCards.mockResolvedValue({
      cards: [],
      total: 0,
    });

    renderDelegationBoard();

    await waitFor(() => {
      expect(mockApiObj.listDelegationTaskCards).toHaveBeenCalledWith(
        "message-1",
      );
    });

    expect(screen.queryByText(/派出的任务/)).not.toBeInTheDocument();
  });

  it("refreshes delegation cards after submitting a drawer comment", async () => {
    const { queryClient } = renderDelegationBoard();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => {
      expect(screen.getByText("派出的任务 · 1 张")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /FAI-12/ }));
    await screen.findByTestId("sheet");

    fireEvent.change(screen.getByPlaceholderText("补充评论…"), {
      target: { value: "Follow up on the report" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送评论" }));

    await waitFor(() => {
      expect(mockApiObj.createComment).toHaveBeenCalledWith(
        "issue-1",
        "Follow up on the report",
        undefined,
        undefined,
        undefined,
      );
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: teamKeys.delegationCards("ws-1", "message-1"),
      });
    });
  });

  it("keeps the draft and does not refresh delegation cards when comment submit fails", async () => {
    mockApiObj.createComment.mockRejectedValueOnce(new Error("submit failed"));
    const { queryClient } = renderDelegationBoard();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => {
      expect(screen.getByText("派出的任务 · 1 张")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /FAI-12/ }));
    await screen.findByTestId("sheet");

    const input = screen.getByPlaceholderText("补充评论…");
    fireEvent.change(input, {
      target: { value: "Keep this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送评论" }));

    await waitFor(() => {
      expect(mockApiObj.createComment).toHaveBeenCalledWith(
        "issue-1",
        "Keep this draft",
        undefined,
        undefined,
        undefined,
      );
    });

    expect(input).toHaveValue("Keep this draft");
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: teamKeys.delegationCards("ws-1", "message-1"),
    });
  });
});
