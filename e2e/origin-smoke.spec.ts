import { expect, test } from "@playwright/test";
import { TestApiClient } from "./fixtures";

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
        checkForUpdates: async () => ({ ok: true, currentVersion: "e2e", latestVersion: "e2e", available: false }),
        downloadUpdate: async () => {},
        installUpdate: async () => {},
      },
    });
  });
}

test.describe("Origin smoke", () => {
  let api: TestApiClient;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    await installDesktopStubs(page);
    api = new TestApiClient();
    const suffix = Date.now();
    await api.login(`origin-smoke-${suffix}@multica.ai`, "Origin Smoke");
    const workspace = await api.ensureWorkspace(
      `Origin Smoke ${suffix}`,
      `origin-smoke-${suffix}`,
    );
    workspaceSlug = workspace.slug;
    const token = api.getToken();
    await page.goto("/login");
    await page.evaluate((t) => {
      localStorage.setItem("multica_token", t);
    }, token);
    await page.goto(`/${workspace.slug}/workbench`);
  });

  test.afterEach(async () => {
    await api.cleanup();
  });

  test("logs in, opens a project workspace, and refreshes a delegation card after drawer comment", async ({ page }) => {
    await expect(page.getByText("工作台").first()).toBeVisible({ timeout: 15000 });

    const label = `OriginSmoke${Date.now()}`;
    const fixture = await api.createOriginProjectFixture(label);

    await page
      .getByRole("button", { name: "从空白工作区开始" })
      .click({ timeout: 5000 })
      .catch(() => {});
    await expect(
      page.getByRole("dialog", { name: "欢迎使用，要添加入门任务吗？" }),
    ).toBeHidden({ timeout: 10000 });
    await page.reload();
    await expect(page.getByText("工作台").first()).toBeVisible({ timeout: 15000 });

    const projectLink = page
      .locator(`a[href="/${workspaceSlug}/workspaces/${fixture.project.id}"]`)
      .first();
    await expect(projectLink).toBeVisible({ timeout: 15000 });
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
  });
});
