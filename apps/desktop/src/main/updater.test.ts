import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    channel: undefined as string | undefined,
    on: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn(),
  };

  return {
    ipcHandlers,
    app: {
      getVersion: vi.fn(() => "1.0.0"),
    },
    autoUpdater,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, handler);
      }),
    },
  };
});

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: class BrowserWindow {},
  ipcMain: mocks.ipcMain,
}));

vi.mock("electron-updater", () => ({
  autoUpdater: mocks.autoUpdater,
}));

import {
  AUTO_UPDATE_ENABLE_ENV,
  UPDATE_CHECKS_DISABLED_MESSAGE,
  areUpdateChecksEnabled,
  setupAutoUpdater,
} from "./updater";

describe("areUpdateChecksEnabled", () => {
  it("uses the runtime opt-in when the release build flag is not compiled in", () => {
    expect(areUpdateChecksEnabled({})).toBe(false);
    expect(areUpdateChecksEnabled({ [AUTO_UPDATE_ENABLE_ENV]: "true" })).toBe(
      false,
    );
    expect(areUpdateChecksEnabled({ [AUTO_UPDATE_ENABLE_ENV]: "1" })).toBe(true);
  });
});

describe("setupAutoUpdater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.ipcHandlers.clear();
    delete process.env[AUTO_UPDATE_ENABLE_ENV];
    mocks.app.getVersion.mockReturnValue("1.0.0");
    mocks.autoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: "1.1.0" },
      isUpdateAvailable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env[AUTO_UPDATE_ENABLE_ENV];
  });

  it("does not contact the update provider by default", async () => {
    setupAutoUpdater(() => null);

    await vi.advanceTimersByTimeAsync(5_001);

    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();

    const checkHandler = mocks.ipcHandlers.get("updater:check");
    expect(checkHandler).toBeDefined();
    await expect(checkHandler?.()).resolves.toEqual({
      ok: false,
      error: UPDATE_CHECKS_DISABLED_MESSAGE,
    });
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("checks for updates when explicitly enabled", async () => {
    process.env[AUTO_UPDATE_ENABLE_ENV] = "1";
    setupAutoUpdater(() => null);

    await vi.advanceTimersByTimeAsync(5_001);

    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    const checkHandler = mocks.ipcHandlers.get("updater:check");
    expect(checkHandler).toBeDefined();
    await expect(checkHandler?.()).resolves.toEqual({
      ok: true,
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      available: true,
    });
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
