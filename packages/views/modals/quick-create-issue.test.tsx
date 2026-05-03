import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockLastAgentId = vi.hoisted(() => "agent-codex");
const mockSetLastAgentId = vi.hoisted(() => vi.fn());
const mockSetKeepOpen = vi.hoisted(() => vi.fn());
const mockSetLastMode = vi.hoisted(() => vi.fn());
const mockSetDraft = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => ({ name: "Fairy" }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-test",
}));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

vi.mock("@multica/core/workspace/queries", () => ({
  memberListOptions: () => ({
    queryKey: ["members"],
    queryFn: () =>
      Promise.resolve([
        { user_id: "user-1", name: "Albert", role: "owner" },
      ]),
  }),
  agentListOptions: () => ({
    queryKey: ["agents"],
    queryFn: () =>
      Promise.resolve([
        {
          id: "agent-codex",
          name: "Codex Local",
          description: "本机 Codex 智能体",
          archived_at: null,
          runtime_id: "runtime-codex",
          owner_id: "user-1",
          visibility: "private",
        },
        {
          id: "agent-claude",
          name: "Claude Local",
          description: "本机 Claude Code 智能体",
          archived_at: null,
          runtime_id: "runtime-claude",
          owner_id: "user-1",
          visibility: "private",
        },
      ]),
  }),
}));

vi.mock("@multica/core/runtimes", () => ({
  MIN_QUICK_CREATE_CLI_VERSION: "0.0.0",
  runtimeListOptions: () => ({
    queryKey: ["runtimes"],
    queryFn: () =>
      Promise.resolve([
        { id: "runtime-codex", metadata: { cli_version: "9.9.9" } },
      ]),
  }),
  readRuntimeCliVersion: () => "9.9.9",
  checkQuickCreateCliVersion: () => ({
    state: "ok",
    current: "9.9.9",
    min: "0.0.0",
  }),
}));

vi.mock("@multica/core/issues/stores/quick-create-store", () => ({
  useQuickCreateStore: (selector: (state: {
    lastAgentId: string;
    setLastAgentId: typeof mockSetLastAgentId;
    keepOpen: boolean;
    setKeepOpen: typeof mockSetKeepOpen;
  }) => unknown) =>
    selector({
      lastAgentId: mockLastAgentId,
      setLastAgentId: mockSetLastAgentId,
      keepOpen: false,
      setKeepOpen: mockSetKeepOpen,
    }),
}));

vi.mock("@multica/core/issues/stores/create-mode-store", () => ({
  useCreateModeStore: (selector: (state: { setLastMode: typeof mockSetLastMode }) => unknown) =>
    selector({ setLastMode: mockSetLastMode }),
}));

vi.mock("@multica/core/issues/stores/draft-store", () => ({
  useIssueDraftStore: Object.assign(() => ({}), {
    getState: () => ({ setDraft: mockSetDraft }),
  }),
}));

vi.mock("@multica/core/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ uploadWithToast: vi.fn(), uploading: false }),
}));

vi.mock("@multica/core/api", () => ({
  api: { quickCreateIssue: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock("../editor", () => {
  const ContentEditor = forwardRef(({ defaultValue, onUpdate, placeholder }: any, ref: any) => {
    const valueRef = useRef(defaultValue || "");
    const [value, setValue] = useState(defaultValue || "");
    useImperativeHandle(ref, () => ({
      getMarkdown: () => valueRef.current,
      clearContent: () => {
        valueRef.current = "";
        setValue("");
      },
      focus: vi.fn(),
      uploadFile: vi.fn(),
    }));
    return (
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          valueRef.current = e.target.value;
          setValue(e.target.value);
          onUpdate?.(e.target.value);
        }}
      />
    );
  });
  ContentEditor.displayName = "ContentEditor";

  return {
    ContentEditor,
    FileDropOverlay: () => null,
    useFileDropZone: () => ({ isDragOver: false, dropZoneProps: {} }),
  };
});

vi.mock("@multica/ui/components/ui/dialog", () => ({
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@multica/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, className }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  ),
}));

vi.mock("@multica/ui/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@multica/ui/components/ui/button", () => ({
  Button: ({ children, disabled, onClick }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@multica/ui/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
  }) => (
    <input
      aria-label="连续创建"
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
    />
  ),
}));

vi.mock("@multica/ui/components/common/file-upload-button", () => ({
  FileUploadButton: () => <button type="button">上传文件</button>,
}));

vi.mock("@multica/ui/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

import { AgentCreatePanel } from "./quick-create-issue";

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AgentCreatePanel onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("AgentCreatePanel", () => {
  it("renders creator choices as avatar-name picker rows with descriptions", async () => {
    const { container } = renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText("Codex Local").length).toBeGreaterThan(0);
    });
    expect(await screen.findByText("本机 Codex 智能体")).toBeInTheDocument();
    expect(screen.getByText("本机 Claude Code 智能体")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-picker-item]")).toHaveLength(2);
  });
});
