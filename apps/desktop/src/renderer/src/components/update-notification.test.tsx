import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { UpdateNotification } from "./update-notification";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

type UpdaterMock = {
  availableHandlers: Array<(info: { version: string }) => void>;
  progressHandlers: Array<(progress: { percent: number }) => void>;
  downloadedHandlers: Array<() => void>;
  downloadUpdate: ReturnType<typeof vi.fn>;
  installUpdate: ReturnType<typeof vi.fn>;
};

function installBridgeMocks() {
  const updater: UpdaterMock = {
    availableHandlers: [],
    progressHandlers: [],
    downloadedHandlers: [],
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue(undefined),
  };

  Object.defineProperty(window, "updater", {
    configurable: true,
    value: {
      onUpdateAvailable: vi.fn((handler) => {
        updater.availableHandlers.push(handler);
        return vi.fn();
      }),
      onDownloadProgress: vi.fn((handler) => {
        updater.progressHandlers.push(handler);
        return vi.fn();
      }),
      onUpdateDownloaded: vi.fn((handler) => {
        updater.downloadedHandlers.push(handler);
        return vi.fn();
      }),
      checkForUpdates: vi.fn().mockResolvedValue({ ok: true }),
      downloadUpdate: updater.downloadUpdate,
      installUpdate: updater.installUpdate,
    } as unknown as Window["updater"],
  });

  Object.defineProperty(window, "desktopAPI", {
    configurable: true,
    value: {
      openExternal: vi.fn(),
    } as unknown as Window["desktopAPI"],
  });

  return updater;
}

function markUpdateDownloaded(updater: UpdaterMock) {
  act(() => {
    updater.downloadedHandlers.forEach((handler) => handler());
  });
}

describe("UpdateNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a restarting state after clicking install", async () => {
    const updater = installBridgeMocks();
    render(<UpdateNotification />);
    markUpdateDownloaded(updater);

    fireEvent.click(await screen.findByRole("button", { name: "立即重启" }));

    await waitFor(() => expect(updater.installUpdate).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", { name: "正在重启..." }),
    ).toBeDisabled();
    expect(screen.getByText("正在重启 Origin...")).toBeInTheDocument();
  });

  it("restores the ready state and surfaces install failures", async () => {
    const updater = installBridgeMocks();
    updater.installUpdate.mockRejectedValueOnce(new Error("not packaged"));
    render(<UpdateNotification />);
    markUpdateDownloaded(updater);

    fireEvent.click(await screen.findByRole("button", { name: "立即重启" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("重启安装更新失败", {
        description: "not packaged",
      }),
    );
    expect(screen.getByRole("button", { name: "立即重启" })).toBeEnabled();
  });
});
