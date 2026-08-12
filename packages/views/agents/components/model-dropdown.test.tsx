// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AgentRuntime } from "@multica/core/types";
import type { AggregatedRuntimeModel } from "@multica/core/runtimes";

// Shim the popover so trigger + content render inline in jsdom; the dropdown's
// own `open` state and the real aggregation query are what we're exercising.
vi.mock("@multica/ui/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({
    children,
    ...props
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@multica/ui/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

import { ModelDropdown, groupByRuntime } from "./model-dropdown";

function apiRuntime(
  id: string,
  name: string,
  provider: string,
  models: Array<{ id: string; label: string; default?: boolean }>,
): AgentRuntime {
  return {
    id,
    workspace_id: "ws-1",
    daemon_id: `origin-api:${id}`,
    name,
    runtime_mode: "cloud",
    provider,
    launch_header: "",
    status: "online",
    device_info: "",
    metadata: {
      api_runtime: true,
      managed_by: "origin_api",
      models,
    },
    owner_id: "u1",
    last_seen_at: null,
    created_at: "",
    updated_at: "",
  };
}

const deepseek = apiRuntime("rt-1", "DeepSeek API", "deepseek", [
  { id: "deepseek-chat", label: "deepseek-chat", default: true },
  { id: "deepseek-reasoner", label: "deepseek-reasoner" },
]);
const external = apiRuntime("rt-2", "外接模型 API", "custom", [
  { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
]);

function renderDropdown(
  runtimes: AgentRuntime[],
  onChange: (m: string, rt: string) => void,
  runtimeId: string | null = null,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ModelDropdown
        runtimes={runtimes}
        runtimeId={runtimeId}
        value=""
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
}

describe("ModelDropdown", () => {
  it("aggregates multiple API runtimes' metadata.models and groups by runtime", async () => {
    renderDropdown([deepseek, external], vi.fn());

    // Group headers use the runtime name; models come from metadata.models.
    expect(await screen.findByText("DeepSeek API")).toBeInTheDocument();
    expect(screen.getByText("deepseek-chat")).toBeInTheDocument();
    expect(screen.getByText("deepseek-reasoner")).toBeInTheDocument();
    expect(screen.getByText("外接模型 API")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1-mini")).toBeInTheDocument();
  });

  it("reports the selected model's runtime_id", async () => {
    const onChange = vi.fn();
    renderDropdown([deepseek, external], onChange);

    const row = await screen.findByRole("button", { name: /deepseek-chat/ });
    fireEvent.click(row);

    expect(onChange).toHaveBeenCalledWith("deepseek-chat", "rt-1");
  });

  it("reports the external runtime id for its own models", async () => {
    const onChange = vi.fn();
    renderDropdown([deepseek, external], onChange);

    const row = await screen.findByRole("button", { name: /gpt-4.1-mini/ });
    fireEvent.click(row);

    expect(onChange).toHaveBeenCalledWith("gpt-4.1-mini", "rt-2");
  });

  it("suppresses custom model creation when no runtime is bound and shows a hint", () => {
    renderDropdown([deepseek, external], vi.fn());

    const input = screen.getByPlaceholderText("搜索或输入模型 ID");
    fireEvent.change(input, { target: { value: "my-custom-model" } });

    expect(screen.getByText("请先在能力来源选择运行环境")).toBeInTheDocument();
    expect(screen.queryByText(/使用.*my-custom-model/)).not.toBeInTheDocument();
  });

  it("offers custom model creation when a runtime is bound", () => {
    renderDropdown([deepseek, external], vi.fn(), "rt-1");

    const input = screen.getByPlaceholderText("搜索或输入模型 ID");
    fireEvent.change(input, { target: { value: "my-custom-model" } });

    expect(screen.getByText(/使用.*my-custom-model/)).toBeInTheDocument();
    expect(
      screen.queryByText("请先在能力来源选择运行环境"),
    ).not.toBeInTheDocument();
  });
});

describe("groupByRuntime", () => {
  it("groups models by runtime_id, preserving order and naming groups by runtime_name", () => {
    const models: AggregatedRuntimeModel[] = [
      { id: "a", label: "a", runtime_id: "rt-1", runtime_name: "One" },
      { id: "b", label: "b", runtime_id: "rt-2", runtime_name: "Two" },
      { id: "c", label: "c", runtime_id: "rt-1", runtime_name: "One" },
    ];

    const groups = groupByRuntime(models);

    expect(groups.map((g) => g.runtime_id)).toEqual(["rt-1", "rt-2"]);
    expect(groups.map((g) => g.runtime_name)).toEqual(["One", "Two"]);
    expect(groups[0]?.models.map((m) => m.id)).toEqual(["a", "c"]);
    expect(groups[1]?.models.map((m) => m.id)).toEqual(["b"]);
  });
});
