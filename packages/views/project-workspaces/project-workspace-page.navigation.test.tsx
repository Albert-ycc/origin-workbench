import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getProjectV12: vi.fn(),
  getProjectMainChat: vi.fn(),
  listProjectMainChatMessages: vi.fn(),
  listAgents: vi.fn(),
}));

const navigationPush = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", () => ({ api }));

vi.mock("@multica/ui/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const GroupContext = React.createContext(false);

  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DropdownMenuTrigger: ({
      children,
      render,
    }: {
      children: React.ReactNode;
      render: React.ReactElement;
    }) => React.cloneElement(render, {}, children),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => (
      <GroupContext.Provider value>{children}</GroupContext.Provider>
    ),
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => {
      if (!React.useContext(GroupContext)) {
        throw new Error("Base UI group label requires DropdownMenuGroup");
      }
      return <div>{children}</div>;
    },
    DropdownMenuItem: ({
      children,
      disabled,
      onClick,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <hr />,
  };
});

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: <T,>(selector: (state: { user: null }) => T) => selector({ user: null }),
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    projectWorkspaces: () => "/Fairy/workspaces",
  }),
}));

vi.mock("../navigation", () => ({
  useNavigation: () => ({ push: navigationPush }),
}));

import { ProjectWorkspacePage } from "./project-workspace-page";

function renderProjectWorkspacePage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectWorkspacePage projectId="missing-project" />
    </QueryClientProvider>,
  );
}

describe("ProjectWorkspacePage navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProjectV12.mockResolvedValue(null);
    api.getProjectMainChat.mockResolvedValue({ chat_session_id: "chat-1" });
    api.listProjectMainChatMessages.mockResolvedValue({ messages: [], next_cursor: null });
    api.listAgents.mockResolvedValue([]);
  });

  it("returns to the project workspace list from a missing project", async () => {
    const user = userEvent.setup();

    renderProjectWorkspacePage();

    await screen.findByText("项目不存在或已归档");
    await user.click(screen.getByRole("button", { name: "返回" }));

    await waitFor(() => {
      expect(navigationPush).toHaveBeenCalledWith("/Fairy/workspaces");
    });
  });

  it("groups project more menu labels inside Base UI menu groups", async () => {
    api.getProjectV12.mockResolvedValue({
      id: "project-1",
      title: "私域一体化",
      status: "active",
      local_dir: null,
      team_id: null,
      memory_doc: "",
      memory_doc_updated_at: null,
    });

    renderProjectWorkspacePage();

    await screen.findByText("私域一体化");

    expect(screen.getByText("协作类")).toBeInTheDocument();
    expect(screen.getByText("整理 + 重新出发")).toBeInTheDocument();
  });
});
