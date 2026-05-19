import { useEffect } from "react";
import {
  createMemoryRouter,
  Navigate,
  Outlet,
  useMatches,
  useParams,
} from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import { IssueDetailPage } from "./pages/issue-detail-page";
import { ProjectDetailPage } from "./pages/project-detail-page";
import { AutopilotDetailPage } from "./pages/autopilot-detail-page";
import { SkillDetailPage } from "./pages/skill-detail-page";
import { AgentDetailPage } from "./pages/agent-detail-page";
import { RuntimeDetailPage } from "./pages/runtime-detail-page";
import { TeamDetailPage } from "./pages/team-detail-page";
import { IssuesPage } from "@multica/views/issues/components";
import { WorkbenchPage } from "@multica/views/workbench";
import { IdeasPage } from "@multica/views/ideas";
import { CouncilsPage } from "@multica/views/councils";
import { ExplorationsPage } from "@multica/views/explorations";
import { MissionsPage } from "@multica/views/missions";
import { TeamsPage } from "@multica/views/teams";
import { MeetingsPage } from "@multica/views/meetings";
import { ProjectsPage } from "@multica/views/projects/components";
import { ProjectWorkspacesListPage } from "@multica/views/project-workspaces";
import { AutopilotsPage } from "@multica/views/autopilots/components";
import { MyIssuesPage } from "@multica/views/my-issues";
import { SkillsPage } from "@multica/views/skills";
import { DesktopRuntimesPage } from "./components/desktop-runtimes-page";
import { AgentsPage } from "@multica/views/agents";
import { InboxPage } from "@multica/views/inbox";
import { SettingsPage } from "@multica/views/settings";
import { BrainCircuit, Server } from "lucide-react";
import { DaemonSettingsTab } from "./components/daemon-settings-tab";
import { ModelApiSettingsTab } from "./components/model-api-settings-tab";
import { WorkspaceRouteLayout } from "./components/workspace-route-layout";

/**
 * Sets document.title from the deepest matched route's handle.title.
 * The tab system observes document.title via MutationObserver.
 * Pages with dynamic titles (e.g. issue detail) override by setting
 * document.title directly via useDocumentTitle().
 */
function TitleSync() {
  const matches = useMatches();
  const title = [...matches]
    .reverse()
    .find((m) => (m.handle as { title?: string })?.title)
    ?.handle as { title?: string } | undefined;

  useEffect(() => {
    if (title?.title) document.title = title.title;
  }, [title?.title]);

  return null;
}

/** Wrapper that renders route children + TitleSync */
function PageShell() {
  return (
    <>
      <TitleSync />
      <Outlet />
    </>
  );
}

function ProjectWorkspacesRoute() {
  const { id } = useParams<{ id: string }>();
  return <ProjectWorkspacesListPage projectId={id} />;
}

function ProjectMeetingsRoute() {
  const { id, meetingId } = useParams<{ id: string; meetingId?: string }>();
  if (!id) return <Navigate to="../workspaces" replace />;
  return <MeetingsPage projectId={id} meetingId={meetingId} />;
}

function MeetingsRoute() {
  const { meetingId } = useParams<{ meetingId?: string }>();
  return <MeetingsPage meetingId={meetingId} />;
}

/**
 * Route definitions shared by all tabs.
 *
 * Every tab path is workspace-scoped: `/{slug}/{route}/...`. Pre-workspace
 * flows (create workspace, accept invite) are NOT routes — they render as a
 * window-level overlay via `WindowOverlay`, dispatched by the navigation
 * adapter's transition-path interception. The `activeWorkspaceSlug` in the
 * tab store decides which workspace's tabs are visible in the TabBar;
 * workspace-less state (zero-workspace user) shows the overlay instead.
 *
 * The root index route stays as a harmless safety net. With per-workspace
 * tabs, nothing should construct a tab at `/` — but if one ever slips
 * through (malformed persisted state that dodges the migration, direct
 * router.navigate from unforeseen code), the index falls back to null
 * rather than 404; App.tsx's bootstrap repoints activeWorkspaceSlug on the
 * next render pass.
 */
export const appRoutes: RouteObject[] = [
  {
    element: <PageShell />,
    children: [
      { index: true, element: null },
      {
        path: ":workspaceSlug",
        element: <WorkspaceRouteLayout />,
        children: [
          { index: true, element: <Navigate to="workbench" replace /> },
          { path: "workbench", element: <WorkbenchPage />, handle: { title: "原点工作台" } },
          { path: "ideas", element: <IdeasPage />, handle: { title: "想法池" } },
          { path: "councils", element: <CouncilsPage />, handle: { title: "会议室" } },
          { path: "missions", element: <MissionsPage />, handle: { title: "任务中枢" } },
          { path: "explorations", element: <ExplorationsPage />, handle: { title: "分叉探索" } },
          { path: "issues", element: <IssuesPage />, handle: { title: "任务" } },
          {
            path: "issues/:id",
            element: <IssueDetailPage />,
            handle: { title: "任务" },
          },
          {
            path: "projects",
            element: <ProjectsPage />,
            handle: { title: "项目" },
          },
          {
            path: "projects/:id",
            element: <ProjectDetailPage />,
            handle: { title: "项目" },
          },
          // v1.2 项目工作区 (PRD §17). 走 /workspaces 路径区隔旧 /projects
          // 二栏布局：list-page 自己内嵌 detail，:id 决定选哪个项目
          {
            path: "workspaces",
            element: <ProjectWorkspacesRoute />,
            handle: { title: "项目工作区" },
          },
          {
            path: "workspaces/:id",
            element: <ProjectWorkspacesRoute />,
            handle: { title: "项目工作区" },
          },
          {
            path: "workspaces/:id/meetings",
            element: <ProjectMeetingsRoute />,
            handle: { title: "会议 Copilot" },
          },
          {
            path: "workspaces/:id/meetings/:meetingId",
            element: <ProjectMeetingsRoute />,
            handle: { title: "会议 Copilot" },
          },
          {
            path: "meetings",
            element: <MeetingsRoute />,
            handle: { title: "会议 Copilot" },
          },
          {
            path: "meetings/:meetingId",
            element: <MeetingsRoute />,
            handle: { title: "会议 Copilot" },
          },
          {
            path: "autopilots",
            element: <AutopilotsPage />,
            handle: { title: "自动巡航" },
          },
          {
            path: "autopilots/:id",
            element: <AutopilotDetailPage />,
            handle: { title: "自动巡航" },
          },
          {
            path: "my-issues",
            element: <MyIssuesPage />,
            handle: { title: "我的任务" },
          },
          {
            path: "runtimes",
            element: <DesktopRuntimesPage />,
            handle: { title: "能力池" },
          },
          {
            path: "runtimes/:id",
            element: <RuntimeDetailPage />,
            handle: { title: "能力池" },
          },
          { path: "skills", element: <SkillsPage />, handle: { title: "技能" } },
          {
            path: "skills/:id",
            element: <SkillDetailPage />,
            handle: { title: "技能" },
          },
          { path: "agents", element: <AgentsPage />, handle: { title: "智能体" } },
          {
            path: "agents/:id",
            element: <AgentDetailPage />,
            handle: { title: "智能体" },
          },
          { path: "teams", element: <TeamsPage />, handle: { title: "团队" } },
          {
            path: "teams/:id",
            element: <TeamDetailPage />,
            handle: { title: "团队" },
          },
          { path: "inbox", element: <InboxPage />, handle: { title: "收件箱" } },
          {
            path: "settings",
            element: (
              <SettingsPage
                extraAccountTabs={[
                  {
                    value: "model-api",
                    label: "大模型 API",
                    icon: BrainCircuit,
                    content: <ModelApiSettingsTab />,
                  },
                  {
                    value: "daemon",
                    label: "守护进程",
                    icon: Server,
                    content: <DaemonSettingsTab />,
                  },
                ]}
              />
            ),
            handle: { title: "设置" },
          },
        ],
      },
    ],
  },
];

/** Create an independent memory router for a tab. */
export function createTabRouter(initialPath: string) {
  return createMemoryRouter(appRoutes, {
    initialEntries: [initialPath],
  });
}
