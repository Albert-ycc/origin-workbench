import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentRuntime } from "@multica/core/types";

// Mock the core onboarding module BEFORE the SUT imports it.
const mocks = vi.hoisted(() => ({
  joinCloudWaitlist: vi.fn(),
  pickerState: {
    runtimes: [] as AgentRuntime[],
    selected: null as AgentRuntime | null,
    selectedId: null as string | null,
    setSelectedId: vi.fn<(id: string) => void>(),
    hasRuntimes: false,
  },
}));

// Partial mock — preserve ONBOARDING_STEP_ORDER etc. that StepHeader
// (rendered inside the fork) reaches for, while replacing the network
// call we want to assert on.
vi.mock("@multica/core/onboarding", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@multica/core/onboarding")>();
  return {
    ...actual,
    joinCloudWaitlist: mocks.joinCloudWaitlist,
  };
});

// Swap out the runtime picker so tests can drive runtimes / selection
// without a real TanStack Query + WS stack.
vi.mock("../components/use-runtime-picker", () => ({
  useRuntimePicker: () => mocks.pickerState,
}));

import { StepPlatformFork } from "./step-platform-fork";

function makeRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    id: "rt_test",
    workspace_id: "ws_test",
    name: "Claude Code",
    provider: "claude",
    status: "online",
    runtime_mode: "local",
    runtime_config: {},
    device_info: "",
    metadata: {},
    daemon_id: null,
    last_seen_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as unknown as AgentRuntime;
}

function renderFork(
  overrides: Partial<React.ComponentProps<typeof StepPlatformFork>> = {},
) {
  const onNext = vi.fn();
  render(
    <StepPlatformFork
      wsId="ws_test"
      onNext={onNext}
      cliInstructions={<div data-testid="cli-instructions">install me</div>}
      {...overrides}
    />,
  );
  return { onNext };
}

function resetPicker(patch: Partial<typeof mocks.pickerState> = {}) {
  mocks.pickerState.runtimes = patch.runtimes ?? [];
  mocks.pickerState.selected = patch.selected ?? null;
  mocks.pickerState.selectedId = patch.selectedId ?? null;
  mocks.pickerState.hasRuntimes = patch.hasRuntimes ?? false;
  mocks.pickerState.setSelectedId = vi.fn();
}

describe("StepPlatformFork", () => {
  beforeEach(() => {
    mocks.joinCloudWaitlist.mockReset();
    resetPicker();
    vi.restoreAllMocks();
  });

  it("renders the three fork options at rest", () => {
    renderFork();
    expect(screen.getByText(/下载桌面版/i)).toBeInTheDocument();
    expect(screen.getByText(/^安装 CLI$/i)).toBeInTheDocument();
    expect(screen.getByText(/^云端运行环境$/i)).toBeInTheDocument();
    // Dialogs closed at rest → no CLI instructions, no email field.
    expect(screen.queryByTestId("cli-instructions")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/邮箱/i)).not.toBeInTheDocument();
  });

  it("footer: Skip only + explanatory hint (no Continue)", () => {
    renderFork();
    expect(
      screen.getByRole("button", { name: /暂时跳过/i }),
    ).toBeEnabled();
    // Continue is gone — it lived in the footer before; now advancement
    // for the CLI path is owned by the CLI dialog's own button.
    expect(
      screen.queryByRole("button", { name: /^继续$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/请选择上方路径，也可以先跳过/i),
    ).toBeInTheDocument();
  });

  it("Skip is always enabled and calls onNext(null)", async () => {
    const user = userEvent.setup();
    const { onNext } = renderFork();
    await user.click(screen.getByRole("button", { name: /暂时跳过/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledWith(null);
  });

  it("opens the download page and flips the card to a post-click state", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();
    renderFork();

    await user.click(screen.getByText(/下载桌面版/i));

    // Routes to the new /download page (not GitHub releases) so the
    // user lands on the OS auto-detect surface.
    expect(openSpy).toHaveBeenCalledWith(
      "/download",
      "_blank",
      "noopener,noreferrer",
    );
    expect(
      screen.getByText(/正在下载页继续/i),
    ).toBeInTheDocument();
  });

  it("CLI dialog: opens with instructions + 'waiting' and a disabled Connect button", async () => {
    const user = userEvent.setup();
    renderFork();

    await user.click(screen.getByRole("button", { name: /查看步骤/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("cli-instructions")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/正在监听你的守护进程/i),
    ).toBeInTheDocument();
    // Connect & continue stays disabled while no runtime is selected.
    expect(
      within(dialog).getByRole("button", { name: /连接并继续/i }),
    ).toBeDisabled();
  });

  it("CLI dialog with a selected runtime: Connect enables and fires onNext(runtime)", async () => {
    const rt = makeRuntime({ id: "rt_claude", name: "Claude Code" });
    resetPicker({
      runtimes: [rt],
      selected: rt,
      selectedId: rt.id,
      hasRuntimes: true,
    });
    const user = userEvent.setup();
    const { onNext } = renderFork();

    await user.click(screen.getByRole("button", { name: /查看步骤/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/已连接 1 个运行环境/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/已选择：Claude Code/i),
    ).toBeInTheDocument();

    const connect = within(dialog).getByRole("button", {
      name: /连接并继续/i,
    });
    expect(connect).toBeEnabled();
    await user.click(connect);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledWith(rt);
  });

  it("Cloud dialog submission does NOT advance the flow", async () => {
    // Even with runtimes detected in the background, submitting the
    // cloud waitlist form must not call onNext — it's pure interest
    // capture. The user still has to hit Skip explicitly afterwards.
    const rt = makeRuntime();
    resetPicker({
      runtimes: [rt],
      selected: rt,
      selectedId: rt.id,
      hasRuntimes: true,
    });
    mocks.joinCloudWaitlist.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { onNext } = renderFork();

    await user.click(screen.getByRole("button", { name: /^加入候补$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/邮箱/i), "a@b.co");
    await user.click(
      within(dialog).getByRole("button", { name: /^加入候补名单$/i }),
    );

    expect(mocks.joinCloudWaitlist).toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("Cloud submit: disables button, shows 'on the list', does NOT navigate", async () => {
    mocks.joinCloudWaitlist.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { onNext } = renderFork();

    await user.click(screen.getByRole("button", { name: /^加入候补$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/邮箱/i), "a@b.co");
    await user.type(
      within(dialog).getByLabelText(/为什么需要云端/i),
      "running agents overnight",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /^加入候补名单$/i }),
    );

    expect(mocks.joinCloudWaitlist).toHaveBeenCalledTimes(1);
    expect(mocks.joinCloudWaitlist).toHaveBeenCalledWith(
      "a@b.co",
      "running agents overnight",
    );
    // Cloud submit is pure side effect — it must NOT advance the flow.
    expect(onNext).not.toHaveBeenCalled();
    // Form button locks out after submit.
    expect(
      within(dialog).getByRole("button", { name: /已加入名单/i }),
    ).toBeDisabled();
    // Footer hint flips to reflect submitted state.
    expect(
      screen.getByText(/你已加入候补名单，可以点击“跳过”继续探索/i),
    ).toBeInTheDocument();
  });

  it("Cloud submit: empty reason is allowed, reason forwarded as ''", async () => {
    mocks.joinCloudWaitlist.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderFork();

    await user.click(screen.getByRole("button", { name: /^加入候补$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/邮箱/i),
      "solo@example.com",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /^加入候补名单$/i }),
    );

    expect(mocks.joinCloudWaitlist).toHaveBeenCalledWith(
      "solo@example.com",
      "",
    );
  });

  it("Cloud submit stays disabled until email is valid", async () => {
    const user = userEvent.setup();
    renderFork();

    await user.click(screen.getByRole("button", { name: /^加入候补$/i }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", {
      name: /^加入候补名单$/i,
    });
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/邮箱/i), "not-an-email");
    expect(submit).toBeDisabled();

    await user.clear(within(dialog).getByLabelText(/邮箱/i));
    await user.type(
      within(dialog).getByLabelText(/邮箱/i),
      "someone@example.com",
    );
    expect(submit).toBeEnabled();
  });
});
