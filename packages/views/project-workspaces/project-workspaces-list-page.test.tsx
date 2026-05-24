import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listAgents: vi.fn(),
  listProjectsV12: vi.fn(),
  createProjectV12: vi.fn(),
}));

const navigationPush = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", () => ({ api }));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    projectWorkspaceDetail: (id: string) => `/Fairy/workspaces/${id}`,
  }),
}));

vi.mock("../navigation", () => ({
  useNavigation: () => ({ push: navigationPush }),
}));

vi.mock("./project-workspace-page", () => ({
  ProjectWorkspacePage: ({ projectId }: { projectId: string }) => (
    <div>Project {projectId}</div>
  ),
}));

import { ProjectWorkspacesListPage } from "./project-workspaces-list-page";

function renderProjectWorkspacesListPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectWorkspacesListPage />
    </QueryClientProvider>,
  );
}

describe("ProjectWorkspacesListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem("origin:project-sidebar-collapsed", "1");
    api.listProjectsV12.mockResolvedValue({ projects: [], total: 0 });
    api.listAgents.mockResolvedValue([]);
    api.createProjectV12.mockResolvedValue({
      id: "project-1",
      title: "新项目",
    });
  });

  it("offers project creation from the main empty state when the project list is collapsed", async () => {
    const user = userEvent.setup();

    renderProjectWorkspacesListPage();

    await screen.findByText("还没有项目");
    expect(screen.getAllByText("项目主聊").length).toBeGreaterThan(0);
    expect(screen.getByText("Mission / Idea / Council")).toBeInTheDocument();
    expect(screen.getAllByText("协作成员").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "新建项目" }));

    expect(screen.getByRole("dialog", { name: "新建项目" })).toBeInTheDocument();
  });
});
