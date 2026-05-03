import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchCommand } from "./search-command";
import { useSearchStore } from "./search-store";

const {
  mockPush,
  mockSearchIssues,
  mockSearchProjects,
  mockRecentItems,
  mockAllIssues,
  mockSetTheme,
  mockTheme,
  mockPathname,
  mockGetShareableUrl,
  mockWorkspaces,
  mockCurrentWorkspace,
  mockOpenModal,
  mockToastSuccess,
  mockClipboardWrite,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockSearchIssues: vi.fn(),
  mockSearchProjects: vi.fn(),
  mockRecentItems: { current: [] as Array<{ id: string; visitedAt: number }> },
  mockAllIssues: { current: [] as Array<Record<string, unknown>> },
  mockSetTheme: vi.fn(),
  mockTheme: { current: "system" as "light" | "dark" | "system" },
  mockPathname: { current: "/ws-test/issues" as string },
  mockGetShareableUrl: vi.fn((p: string) => `https://app.multica/${p}`),
  mockWorkspaces: {
    current: [] as Array<{ id: string; name: string; slug: string }>,
  },
  mockCurrentWorkspace: {
    current: null as { id: string; name: string; slug: string } | null,
  },
  mockOpenModal: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockClipboardWrite: vi.fn(() => Promise.resolve()),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    searchIssues: mockSearchIssues,
    searchProjects: mockSearchProjects,
  },
}));

vi.mock("@multica/core/issues/stores", () => ({
  useRecentIssuesStore: (selector?: (state: { items: typeof mockRecentItems.current }) => unknown) => {
    const state = { items: mockRecentItems.current };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@multica/core", () => ({
  useWorkspaceId: () => "ws-test",
}));

vi.mock("@multica/core/paths", () => ({
  paths: {
    workspace: (slug: string) => ({
      root: () => `/${slug}/workbench`,
      workbench: () => `/${slug}/workbench`,
      ideas: () => `/${slug}/ideas`,
      councils: () => `/${slug}/councils`,
      issues: () => `/${slug}/issues`,
      missions: () => `/${slug}/missions`,
      explorations: () => `/${slug}/explorations`,
    }),
  },
  useCurrentWorkspace: () => mockCurrentWorkspace.current,
  useWorkspacePaths: () => ({
    root: () => "/ws-test/workbench",
    workbench: () => "/ws-test/workbench",
    ideas: () => "/ws-test/ideas",
    councils: () => "/ws-test/councils",
    inbox: () => "/ws-test/inbox",
    myIssues: () => "/ws-test/my-issues",
    missions: () => "/ws-test/missions",
    explorations: () => "/ws-test/explorations",
    issues: () => "/ws-test/issues",
    projects: () => "/ws-test/projects",
    autopilots: () => "/ws-test/autopilots",
    teams: () => "/ws-test/teams",
    agents: () => "/ws-test/agents",
    runtimes: () => "/ws-test/runtimes",
    skills: () => "/ws-test/skills",
    settings: () => "/ws-test/settings",
    issueDetail: (id: string) => `/ws-test/issues/${id}`,
    projectDetail: (id: string) => `/ws-test/projects/${id}`,
  }),
}));

vi.mock("@multica/core/issues/queries", () => ({
  issueDetailOptions: (_wsId: string, id: string) => ({
    queryKey: ["issues", "ws-test", "detail", id],
  }),
}));

vi.mock("@multica/core/workspace/queries", () => ({
  workspaceListOptions: () => ({ queryKey: ["workspaces", "list"], enabled: false }),
}));

vi.mock("@multica/core/modals", () => ({
  useModalStore: Object.assign(vi.fn(), {
    getState: () => ({ open: mockOpenModal }),
  }),
}));

function resolveIssue(key: readonly unknown[]) {
  // issueDetailOptions key shape: ["issues", wsId, "detail", id]
  if (key[0] === "issues" && key[2] === "detail") {
    const id = key[3];
    return mockAllIssues.current.find((i) => i.id === id);
  }
  return undefined;
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const key = opts.queryKey;
    if (key[0] === "workspaces") return { data: mockWorkspaces.current };
    if (opts.enabled === false) return { data: undefined };
    return { data: resolveIssue(key) };
  },
  useQueries: (opts: { queries: Array<{ queryKey: readonly unknown[] }> }) =>
    opts.queries.map((q) => ({ data: resolveIssue(q.queryKey) })),
}));

vi.mock("../navigation", () => ({
  useNavigation: () => ({
    push: mockPush,
    pathname: mockPathname.current,
    getShareableUrl: mockGetShareableUrl,
  }),
}));

vi.mock("@multica/ui/components/common/theme-provider", () => ({
  useTheme: () => ({ theme: mockTheme.current, setTheme: mockSetTheme }),
}));

vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: vi.fn() },
}));

describe("SearchCommand", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSearchIssues.mockReset().mockResolvedValue({ issues: [] });
    mockSearchProjects.mockReset().mockResolvedValue({ projects: [] });
    mockRecentItems.current = [];
    mockAllIssues.current = [];
    mockSetTheme.mockReset();
    mockTheme.current = "system";
    mockPathname.current = "/ws-test/issues";
    mockGetShareableUrl.mockReset().mockImplementation((p: string) => `https://app.multica/${p}`);
    mockWorkspaces.current = [];
    mockCurrentWorkspace.current = null;
    mockOpenModal.mockReset();
    mockToastSuccess.mockReset();
    mockClipboardWrite.mockReset().mockResolvedValue(undefined);

    // cmdk calls scrollIntoView on the first selected item, which jsdom doesn't implement
    Element.prototype.scrollIntoView = vi.fn();

    act(() => {
      useSearchStore.setState({ open: true });
    });
  });

  it("closes on a single Escape press from the search input", async () => {
    const user = userEvent.setup();

    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.click(input);

    expect(useSearchStore.getState().open).toBe(true);

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(useSearchStore.getState().open).toBe(false);
    });
    expect(screen.queryByPlaceholderText("输入命令或搜索...")).not.toBeInTheDocument();
  });

  it("shows only new Mission by default and hides pages / workspace switch / low-frequency commands until query", () => {
    render(<SearchCommand />);

    expect(screen.queryByText("页面")).not.toBeInTheDocument();
    expect(screen.queryByText("切换本地空间")).not.toBeInTheDocument();
    // Only the primary creation action surfaces on empty query; everything
    // else (theme, copy, new project) must be revealed by typing.
    expect(screen.getByText("命令")).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.textContent === "新建 Mission" && el?.tagName === "SPAN"),
    ).toBeInTheDocument();
    expect(screen.queryByText("新建项目")).not.toBeInTheDocument();
    expect(screen.queryByText("切换到浅色主题")).not.toBeInTheDocument();
    expect(screen.queryByText("切换到深色主题")).not.toBeInTheDocument();
    expect(screen.queryByText("跟随系统主题")).not.toBeInTheDocument();
  });

  it("filters navigation pages by query", async () => {
    const user = userEvent.setup();
    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input, "set");

    await waitFor(() => {
      // HighlightText splits text, so use a function matcher
      expect(screen.getByText((_, el) => el?.textContent === "设置" && el?.tagName === "SPAN")).toBeInTheDocument();
    });
    expect(screen.queryByText("收件箱")).not.toBeInTheDocument();
  });

  it("navigates to page on selection", async () => {
    const user = userEvent.setup();
    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input, "settings");

    const settingsItem = await screen.findByText("设置");
    await user.click(settingsItem);

    expect(mockPush).toHaveBeenCalledWith("/ws-test/settings");
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("renders recent issues from query cache joined with store visit records", () => {
    mockRecentItems.current = [
      { id: "issue-1", visitedAt: 1000 },
      { id: "issue-2", visitedAt: 900 },
    ];
    mockAllIssues.current = [
      { id: "issue-1", identifier: "MUL-1", title: "First issue", status: "todo" },
      { id: "issue-2", identifier: "MUL-2", title: "Second issue", status: "done" },
    ];

    render(<SearchCommand />);

    expect(screen.getByText("最近")).toBeInTheDocument();
    expect(screen.getByText("First issue")).toBeInTheDocument();
    expect(screen.getByText("MUL-1")).toBeInTheDocument();
    expect(screen.getByText("Second issue")).toBeInTheDocument();
    expect(screen.getByText("MUL-2")).toBeInTheDocument();
  });

  it("shows new Mission / new project under commands and navigates to the mission center", async () => {
    const user = userEvent.setup();
    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input, "new");

    await waitFor(() => {
      expect(screen.getByText("命令")).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === "新建 Mission" && el?.tagName === "SPAN"),
      ).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === "新建项目" && el?.tagName === "SPAN"),
      ).toBeInTheDocument();
    });

    const newMission = await screen.findByText(
      (_, el) => el?.textContent === "新建 Mission" && el?.tagName === "SPAN",
    );
    await user.click(newMission);

    expect(mockPush).toHaveBeenCalledWith("/ws-test/missions");
    expect(mockOpenModal).not.toHaveBeenCalled();
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("hides copy-link commands when not on an issue detail route", async () => {
    const user = userEvent.setup();
    mockPathname.current = "/ws-test/projects";
    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input, "copy");

    // Commands section may still be empty / absent.
    expect(screen.queryByText("复制任务链接")).not.toBeInTheDocument();
  });

  it("copies issue link and identifier when on an issue detail route", async () => {
    const user = userEvent.setup();
    // userEvent.setup() installs its own navigator.clipboard; spy on it so we
    // intercept the writeText call without clobbering userEvent's internals.
    const writeSpy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockImplementation(mockClipboardWrite);
    mockPathname.current = "/ws-test/issues/issue-1";
    mockAllIssues.current = [
      { id: "issue-1", identifier: "MUL-42", title: "Demo", status: "todo" },
    ];
    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input, "copy");

    const linkItem = await screen.findByText(
      (_, el) => el?.textContent === "复制任务链接" && el?.tagName === "SPAN",
    );
    await user.click(linkItem);

    expect(mockGetShareableUrl).toHaveBeenCalledWith("/ws-test/issues/issue-1");
    expect(mockClipboardWrite).toHaveBeenCalledWith("https://app.multica//ws-test/issues/issue-1");
    expect(mockToastSuccess).toHaveBeenCalledWith("链接已复制");

    // Reopen palette and test identifier copy
    act(() => {
      useSearchStore.setState({ open: true });
    });
    const input2 = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input2, "copy");
    const idItem = await screen.findByText(
      (_, el) =>
        el?.textContent === "复制编号（MUL-42）" && el?.tagName === "SPAN",
    );
    await user.click(idItem);
    expect(mockClipboardWrite).toHaveBeenCalledWith("MUL-42");
    expect(mockToastSuccess).toHaveBeenCalledWith("已复制 MUL-42");

    writeSpy.mockRestore();
  });

  it("filters theme commands by query keywords", async () => {
    const user = userEvent.setup();
    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input, "dark");

    await waitFor(() => {
      expect(screen.getByText("命令")).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === "切换到深色主题" && el?.tagName === "SPAN"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("切换到浅色主题")).not.toBeInTheDocument();
    expect(screen.queryByText("跟随系统主题")).not.toBeInTheDocument();
  });

  it("applies the selected theme and closes the palette", async () => {
    const user = userEvent.setup();
    mockTheme.current = "light";
    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input, "dark");

    const darkItem = await screen.findByText(
      (_, el) => el?.textContent === "切换到深色主题" && el?.tagName === "SPAN",
    );
    await user.click(darkItem);

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("matches theme action via generic 'theme' keyword and marks current theme", async () => {
    const user = userEvent.setup();
    mockTheme.current = "dark";
    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input, "theme");

    await waitFor(() => {
      expect(
        screen.getByText((_, el) => el?.textContent === "切换到浅色主题" && el?.tagName === "SPAN"),
      ).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === "切换到深色主题" && el?.tagName === "SPAN"),
      ).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === "跟随系统主题" && el?.tagName === "SPAN"),
      ).toBeInTheDocument();
    });
    expect(screen.getByLabelText("当前主题")).toBeInTheDocument();
  });

  it("lists other workspaces under switch workspace and navigates on select", async () => {
    const user = userEvent.setup();
    mockCurrentWorkspace.current = { id: "ws-current", name: "Current", slug: "current" };
    mockWorkspaces.current = [
      { id: "ws-current", name: "Current", slug: "current" },
      { id: "ws-alpha", name: "Alpha Co", slug: "alpha" },
      { id: "ws-beta", name: "Beta Co", slug: "beta" },
    ];
    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input, "alpha");

    await waitFor(() => {
      expect(screen.getByText("切换本地空间")).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === "Alpha Co" && el?.tagName === "SPAN"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Beta Co")).not.toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();

    const alphaItem = await screen.findByText(
      (_, el) => el?.textContent === "Alpha Co" && el?.tagName === "SPAN",
    );
    await user.click(alphaItem);

    expect(mockPush).toHaveBeenCalledWith("/alpha/workbench");
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("shows all other workspaces when typing 'workspace'", async () => {
    const user = userEvent.setup();
    mockCurrentWorkspace.current = { id: "ws-current", name: "Current", slug: "current" };
    mockWorkspaces.current = [
      { id: "ws-current", name: "Current", slug: "current" },
      { id: "ws-alpha", name: "Alpha Co", slug: "alpha" },
      { id: "ws-beta", name: "Beta Co", slug: "beta" },
    ];
    render(<SearchCommand />);

    const input = screen.getByPlaceholderText("输入命令或搜索...");
    await user.type(input, "workspace");

    await waitFor(() => {
      expect(screen.getByText("切换本地空间")).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === "Alpha Co" && el?.tagName === "SPAN"),
      ).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === "Beta Co" && el?.tagName === "SPAN"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
  });

  it("filters out recent items not present in query cache", () => {
    mockRecentItems.current = [
      { id: "issue-1", visitedAt: 1000 },
      { id: "deleted-issue", visitedAt: 900 },
    ];
    mockAllIssues.current = [
      { id: "issue-1", identifier: "MUL-1", title: "Existing issue", status: "in_progress" },
    ];

    render(<SearchCommand />);

    expect(screen.getByText("最近")).toBeInTheDocument();
    expect(screen.getByText("Existing issue")).toBeInTheDocument();
    expect(screen.queryByText("deleted-issue")).not.toBeInTheDocument();
  });
});
