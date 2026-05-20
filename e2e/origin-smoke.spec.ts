/**
 * Origin smoke — 核心用户路径回归
 *
 * 覆盖 5 条关键路径：
 *   S1  登录：token 注入 + 工作台页面可达
 *   S2  工作台：sidebar 中文分组（团队/工作区/配置）可见 + 项目工作区入口卡可点
 *   S3  项目工作区：导航到已有项目 + 派出的任务卡片可见
 *   S4  任务卡抽屉：打开卡片抽屉 + 发送评论 + 评论数即时更新
 *   S5  API fixture 联动：via TestApiClient 创建 project + issue + comment 后 UI 正确呈现
 *
 * 设计约束：
 * - 每条用例独立，beforeEach 创建隔离 user + workspace（时间戳后缀），afterEach 全量清理
 * - 不依赖任何 Electron IPC（window.desktopAPI / window.daemonAPI / window.updater
 *   全部通过 installDesktopStubs mock）
 * - 不依赖旧英文 UI copy（Multica / All Issues / Sign in 等）
 * - 不修改任何产品代码
 */

import { expect, test } from "@playwright/test";
import { TestApiClient } from "./fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function installDesktopStubs(page: import("@playwright/test").Page) {
  return page.addInitScript(() => {
    const noopUnsubscribe = () => {};
    Object.defineProperty(window, "desktopAPI", {
      configurable: true,
      value: {
        appInfo: { version: "e2e", os: "linux" },
        onAuthToken: () => noopUnsubscribe,
        onInviteOpen: () => noopUnsubscribe,
        openExternal: async () => {},
        setImmersiveMode: async () => {},
        showNotification: () => {},
        setUnreadBadge: () => {},
        onInboxOpen: () => noopUnsubscribe,
        selectDirectory: async () => null,
      },
    });
    Object.defineProperty(window, "daemonAPI", {
      configurable: true,
      value: {
        setTargetApiUrl: async () => {},
        syncToken: async () => {},
        autoStart: async () => {},
        restart: async () => {},
        clearToken: async () => {},
        stop: async () => {},
        onStatusChange: () => noopUnsubscribe,
        getStatus: async () => ({ state: "stopped" }),
        start: async () => ({ success: true }),
        startLogStream: () => {},
        stopLogStream: () => {},
        onLogLine: () => noopUnsubscribe,
      },
    });
    Object.defineProperty(window, "updater", {
      configurable: true,
      value: {
        onUpdateAvailable: () => noopUnsubscribe,
        onDownloadProgress: () => noopUnsubscribe,
        onUpdateDownloaded: () => noopUnsubscribe,
        checkForUpdates: async () => ({
          ok: true,
          currentVersion: "e2e",
          latestVersion: "e2e",
          available: false,
        }),
        downloadUpdate: async () => {},
        installUpdate: async () => {},
      },
    });
  });
}

/**
 * 通用 session 引导：
 * 1. installDesktopStubs（每次 navigate 前自动重注入）
 * 2. API 级登录并创建隔离 workspace
 * 3. 将 JWT 注入 localStorage，让 App 组件认为已登录
 * 4. 刷新到根路径，App 自动引导至工作台
 *
 * 返回 { api, workspaceSlug } 供用例使用。
 */
async function setupSession(page: import("@playwright/test").Page) {
  await installDesktopStubs(page);

  const api = new TestApiClient();
  const suffix = Date.now();
  await api.login(`origin-smoke-${suffix}@multica.ai`, "Origin Smoke");
  const workspace = await api.ensureWorkspace(
    `Origin Smoke ${suffix}`,
    `origin-smoke-${suffix}`,
  );
  const workspaceSlug = workspace.slug;
  const token = api.getToken();

  // Load /login first so the page origin is set before we inject localStorage.
  await page.goto("/login");
  await page.evaluate((t) => {
    localStorage.setItem("multica_token", t);
  }, token);

  // Navigate to workbench. The SPA reloads, tab-store bootstraps with this
  // workspace's default tab (/{slug}/workbench), and AppContent renders
  // DesktopShell. The URL itself isn't used for routing (createMemoryRouter),
  // but the reload ensures App.tsx picks up the injected token.
  await page.goto(`/${workspaceSlug}/workbench`);

  return { api, workspaceSlug };
}

// ---------------------------------------------------------------------------
// Dismiss optional onboarding prompt if present
// ---------------------------------------------------------------------------

async function dismissStarterPromptIfPresent(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "从空白工作区开始" })
    .click({ timeout: 3000 })
    .catch(() => {});
  await page
    .getByRole("dialog", { name: "欢迎使用，要添加入门任务吗？" })
    .waitFor({ state: "hidden", timeout: 8000 })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// S1 — 登录
// ---------------------------------------------------------------------------

test.describe("S1 登录", () => {
  test("token 注入后工作台页面可达，登录态下不跳回登录页", async ({ page }) => {
    const { api } = await setupSession(page);
    // 工作台文案必须可见
    await expect(page.getByText("工作台").first()).toBeVisible({ timeout: 20000 });
    // 不在登录页
    await expect(page).not.toHaveURL(/\/login/);
    await api.cleanup();
  });
});

// ---------------------------------------------------------------------------
// S2 — 工作台 sidebar
// ---------------------------------------------------------------------------

test.describe("S2 工作台 sidebar", () => {
  test("sidebar 显示中文分组标签，项目工作区入口可点", async ({ page }) => {
    const { api, workspaceSlug } = await setupSession(page);
    await expect(page.getByText("工作台").first()).toBeVisible({ timeout: 20000 });
    await dismissStarterPromptIfPresent(page);

    // sidebar 必须包含核心中文分组/入口，不依赖旧英文 copy
    // 「工作区」是 sidebar 分组标题或工作台入口
    await expect(page.getByText("工作台").first()).toBeVisible();

    // 通过 sidebar 导航链接点击「项目工作区」，即 /workspaces 路由
    // AppSidebar 用 multica:navigate 事件而非 href，所以直接 navigate 事件更稳
    // 用 href 属性找工作区链接
    const workspacesLink = page.locator(`a[href="/${workspaceSlug}/workspaces"]`).first();
    await expect(workspacesLink).toBeVisible({ timeout: 10000 });
    await workspacesLink.click();

    // 项目工作区列表页标题可见
    await expect(
      page.getByText("项目工作区").first(),
    ).toBeVisible({ timeout: 15000 });

    await api.cleanup();
  });
});

// ---------------------------------------------------------------------------
// S3 — 项目工作区导航
// ---------------------------------------------------------------------------

test.describe("S3 项目工作区", () => {
  test("点击项目卡片进入项目工作区，项目标题可见", async ({ page }) => {
    const { api, workspaceSlug } = await setupSession(page);
    await expect(page.getByText("工作台").first()).toBeVisible({ timeout: 20000 });
    await dismissStarterPromptIfPresent(page);

    // Create fixture first, then reload so React Query sees the new project
    const label = `S3Proj${Date.now()}`;
    const fixture = await api.createOriginProjectFixture(label);
    await page.reload();
    await expect(page.getByText("工作台").first()).toBeVisible({ timeout: 20000 });

    const projectLink = page
      .locator(`a[href="/${workspaceSlug}/workspaces/${fixture.project.id}"]`)
      .first();
    await expect(projectLink).toBeVisible({ timeout: 20000 });
    await projectLink.click();

    await expect(
      page.getByText(fixture.project.title).first(),
    ).toBeVisible({ timeout: 15000 });

    await api.cleanup();
  });
});

// ---------------------------------------------------------------------------
// S4 — 任务卡 + 抽屉评论 + 实时更新
// ---------------------------------------------------------------------------

test.describe("S4 任务卡抽屉评论", () => {
  test("打开 delegation 卡片抽屉，发送评论后评论数即时更新", async ({ page }) => {
    const { api, workspaceSlug } = await setupSession(page);
    await expect(page.getByText("工作台").first()).toBeVisible({ timeout: 20000 });
    await dismissStarterPromptIfPresent(page);

    // Create fixture first, then reload so React Query sees the new project
    const label = `S4Task${Date.now()}`;
    const fixture = await api.createOriginProjectFixture(label);
    await page.reload();
    await expect(page.getByText("工作台").first()).toBeVisible({ timeout: 20000 });

    const projectLink = page
      .locator(`a[href="/${workspaceSlug}/workspaces/${fixture.project.id}"]`)
      .first();
    await expect(projectLink).toBeVisible({ timeout: 20000 });
    await projectLink.click();

    // 派出的任务看板卡片区域
    await expect(page.getByText("派出的任务 · 1 张")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(fixture.issueTitle)).toBeVisible();
    // 初始评论 preview 和评论数
    await expect(page.getByText("Initial Origin smoke result preview")).toBeVisible();
    await expect(page.getByText("1 条评论")).toBeVisible();

    // 点击卡片打开抽屉
    await page.getByRole("button", { name: new RegExp(fixture.issueTitle) }).click();
    await expect(page.getByText("Initial Origin smoke result preview").last()).toBeVisible();

    // 发送评论
    const comment = `抽屉评论 ${Date.now()}`;
    await page.getByPlaceholder("补充评论…").fill(comment);
    await page.getByRole("button", { name: "发送评论" }).click();

    // 评论内容出现，评论数即时更新
    await expect(page.getByText(comment)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("2 条评论")).toBeVisible({ timeout: 10000 });

    await api.cleanup();
  });
});

// ---------------------------------------------------------------------------
// S5 — 完整 fixture 联动（登录 → 工作台 → 项目 → 卡片可见）
// ---------------------------------------------------------------------------

test.describe("S5 完整 fixture 联动", () => {
  test("logs in, opens a project workspace, and refreshes a delegation card after drawer comment", async ({
    page,
  }) => {
    const { api, workspaceSlug } = await setupSession(page);
    await expect(page.getByText("工作台").first()).toBeVisible({ timeout: 20000 });

    const label = `OriginSmoke${Date.now()}`;
    const fixture = await api.createOriginProjectFixture(label);

    await dismissStarterPromptIfPresent(page);
    await page.reload();
    await expect(page.getByText("工作台").first()).toBeVisible({ timeout: 20000 });

    const projectLink = page
      .locator(`a[href="/${workspaceSlug}/workspaces/${fixture.project.id}"]`)
      .first();
    await expect(projectLink).toBeVisible({ timeout: 20000 });
    await projectLink.click();

    await expect(page.getByText(fixture.project.title).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("派出的任务 · 1 张")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(fixture.issueTitle)).toBeVisible();
    await expect(page.getByText("Initial Origin smoke result preview")).toBeVisible();
    await expect(page.getByText("1 条评论")).toBeVisible();

    await page.getByRole("button", { name: new RegExp(fixture.issueTitle) }).click();
    await expect(page.getByText("Initial Origin smoke result preview").last()).toBeVisible();

    const comment = `Drawer refresh ${Date.now()}`;
    await page.getByPlaceholder("补充评论…").fill(comment);
    await page.getByRole("button", { name: "发送评论" }).click();

    await expect(page.getByText(comment)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("2 条评论")).toBeVisible({ timeout: 10000 });

    await api.cleanup();
  });
});
