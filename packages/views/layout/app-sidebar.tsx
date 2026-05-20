"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@multica/ui/lib/utils";
import { AppLink, useNavigation } from "../navigation";
import { HelpLauncher } from "./help-launcher";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  X,
  Leaf,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@multica/ui/components/ui/tooltip";
import { StatusIcon } from "../issues/components/status-icon";
import { useCreateModeStore } from "@multica/core/issues/stores/create-mode-store";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@multica/ui/components/ui/sidebar";
import { useAuthStore } from "@multica/core/auth";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import { useQuery } from "@tanstack/react-query";
import { useModalStore } from "@multica/core/modals";
import { useMyRuntimesNeedUpdate } from "@multica/core/runtimes/hooks";
import { pinListOptions } from "@multica/core/pins/queries";
import { useDeletePin, useReorderPins } from "@multica/core/pins/mutations";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { projectV12DetailOptions } from "@multica/core/projects-v12";
import type { PinnedItem } from "@multica/core/types";
import { resolveUserAvatarUrl } from "../common/default-avatar";
import { userProfileOptions } from "@multica/core/user-profile";

// Top-level nav items stay active when the user is on a child route
// (e.g. "Projects" stays lit on /:slug/projects/:id). Pinned items keep
// strict equality elsewhere — a pinned project shouldn't highlight on
// sub-pages of itself.
function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// Stable empty arrays for query defaults. Using an inline `= []` default on
// `useQuery` creates a new array reference on every render when `data` is
// undefined (e.g. query disabled or loading) — which in turn breaks any
// `useEffect`/`useMemo` that depends on the value, and can trigger infinite
// re-render loops when the effect itself calls `setState`.
const EMPTY_PINS: PinnedItem[] = [];

// 客厅化 sidebar：只保留三个入口
// - 客厅（主入口）：默认选中，展开当前用户拥有的客厅（chat session）列表
// - 朋友（agent 池）：圆形头像叠加 icon
// - 设置（角落底部，最弱视觉权重）
type NavKey =
  | "workbench"
  | "ideas"
  | "councils"
  | "missions"
  | "issues"
  | "explorations"
  | "projects"
  | "projectWorkspaces"
  | "meetings"
  | "autopilots"
  | "agents"
  | "teams"
  | "runtimes"
  | "skills"
  | "settings";

// 茶杯/沙发图形 icon：用 SVG 内联，避免引入额外依赖
function LivingRoomIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* 茶杯轮廓 */}
      <path d="M3 5h7a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a1 1 0 0 1 1-1Z" />
      <path d="M11 7h1.5a1.5 1.5 0 0 1 0 3H11" />
      <line x1="5" y1="13.5" x2="9" y2="13.5" />
    </svg>
  );
}

// 双圆叠加 icon 代表 agent 朋友池
function FriendsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="6" cy="6.5" r="2.5" />
      <circle cx="10.5" cy="6.5" r="2.5" />
      <path d="M2 14c0-2.2 1.8-4 4-4h4c2.2 0 4 1.8 4 4" />
    </svg>
  );
}

const livingRoomNav: { key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "workbench", label: "客厅", icon: LivingRoomIcon },
  { key: "agents", label: "朋友", icon: FriendsIcon },
];

/**
 * Presentational pin row. The `label` and `iconNode` are computed by the
 * parent `PinRow` from cached issue / project detail queries — keeping
 * this component dumb means the dnd-kit / navigation wiring lives in
 * one place and the data flow is explicit.
 */
function SortablePinItem({
  pin,
  href,
  pathname,
  onUnpin,
  label,
  iconNode,
}: {
  pin: PinnedItem;
  href: string;
  pathname: string;
  onUnpin: () => void;
  label: string;
  iconNode: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pin.id });
  const wasDragged = useRef(false);

  useEffect(() => {
    if (isDragging) wasDragged.current = true;
  }, [isDragging]);

  const style = { transform: CSS.Transform.toString(transform), transition };
  const isActive = pathname === href;

  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={style}
      className={cn("group/pin", isDragging && "opacity-30")}
      {...attributes}
      {...listeners}
    >
      <SidebarMenuButton
        size="sm"
        isActive={isActive}
        render={<AppLink href={href} draggable={false} />}
        onClick={(event) => {
          if (wasDragged.current) {
            wasDragged.current = false;
            event.preventDefault();
            return;
          }
        }}
        className={cn(
          "text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground",
          isDragging && "pointer-events-none",
        )}
      >
        {iconNode}
        <span
          className="min-w-0 flex-1 overflow-hidden whitespace-nowrap"
          style={{
            maskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)",
            WebkitMaskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)",
          }}
        >{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={<span role="button" />}
            className="hidden size-2.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground group-hover/pin:flex hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onUnpin();
            }}
          >
            <X className="size-1" />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>取消固定</TooltipContent>
        </Tooltip>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Smart wrapper that resolves a pin's display data (label + status/icon)
 * from the issue / project detail query cache. Both queries are declared
 * unconditionally with `enabled` gates so the hook order stays stable
 * regardless of `pin.item_type`.
 *
 * Loading: render a flat skeleton so the sidebar height doesn't jump.
 * Missing (deleted item / 404): render nothing — the row hides itself
 * until the user unpins manually or a server-side cascade catches up.
 */
function PinRow({
  pin,
  href,
  pathname,
  onUnpin,
  wsId,
}: {
  pin: PinnedItem;
  href: string;
  pathname: string;
  onUnpin: () => void;
  wsId: string;
}) {
  const isIssue = pin.item_type === "issue";
  const issueQuery = useQuery({
    ...issueDetailOptions(wsId, pin.item_id),
    enabled: isIssue,
  });
  const projectQuery = useQuery({
    ...projectV12DetailOptions(wsId, pin.item_id),
    enabled: !isIssue,
  });

  if (isIssue) {
    if (issueQuery.isPending) return <PinSkeleton />;
    if (issueQuery.isError || !issueQuery.data) return null;
    const issue = issueQuery.data;
    const label = issue.identifier ? `${issue.identifier} ${issue.title}` : issue.title;
    const iconNode = (
      /* Override parent [&_svg]:size-4 — pinned items need smaller icons to match sm size */
      <StatusIcon status={issue.status} className="!size-3.5 shrink-0" />
    );
    return (
      <SortablePinItem
        pin={pin}
        href={href}
        pathname={pathname}
        onUnpin={onUnpin}
        label={label}
        iconNode={iconNode}
      />
    );
  }

  if (projectQuery.isPending) return <PinSkeleton />;
  if (projectQuery.isError || !projectQuery.data) return null;
  const project = projectQuery.data;
  // FolderKanban icon inlined as SVG to avoid re-importing lucide-react icons
  const iconNode = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="!size-3.5 shrink-0">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
      <line x1="8" y1="10" x2="8" y2="16"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="16" y1="10" x2="16" y2="16"/>
    </svg>
  );
  return (
    <SortablePinItem
      pin={pin}
      href={href}
      pathname={pathname}
      onUnpin={onUnpin}
      label={project.title}
      iconNode={iconNode}
    />
  );
}

function PinSkeleton() {
  return (
    <SidebarMenuItem>
      <div className="flex h-7 w-full items-center gap-2 px-2">
        <div className="size-3.5 shrink-0 rounded-sm bg-sidebar-accent/40" />
        <div className="h-3 w-24 rounded bg-sidebar-accent/40" />
      </div>
    </SidebarMenuItem>
  );
}

interface AppSidebarProps {
  /** Rendered above SidebarHeader (e.g. desktop traffic light spacer) */
  topSlot?: React.ReactNode;
  /** Rendered in the header between workspace switcher and new-issue button (e.g. search trigger) */
  searchSlot?: React.ReactNode;
  /** Extra className for SidebarHeader */
  headerClassName?: string;
  /** Extra style for SidebarHeader */
  headerStyle?: React.CSSProperties;
}

export function AppSidebar({ topSlot, searchSlot, headerClassName, headerStyle }: AppSidebarProps = {}) {
  const { pathname } = useNavigation();
  const user = useAuthStore((s) => s.user);
  const userId = useAuthStore((s) => s.user?.id);
  const workspace = useCurrentWorkspace();
  const p = useWorkspacePaths();

  const wsId = workspace?.id;
  // hasRuntimeUpdates 暂时保留 hook 调用以保持 hooks 顺序稳定，但不在 UI 中渲染
  useMyRuntimesNeedUpdate(wsId);
  // Origin §14.10 — surface the user's role card under their name so the
  // sidebar identity row carries actual signal instead of repeating the
  // workspace name (which is hardcoded "Fairy" in single-user mode).
  const profileQuery = useQuery({
    ...userProfileOptions(wsId ?? ""),
    enabled: !!wsId,
  });
  const roleCard = profileQuery.data?.role_card?.trim() ?? "";
  const { data: pinnedItems = EMPTY_PINS } = useQuery({
    ...pinListOptions(wsId ?? "", userId ?? ""),
    enabled: !!wsId && !!userId,
  });
  const deletePin = useDeletePin();
  const reorderPins = useReorderPins();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Local presentational copy of pinnedItems for drop-animation stability.
  // Follows TQ at rest; frozen during a drag gesture so a mid-drag cache
  // write (our own optimistic update, or a WS refetch) cannot reorder the
  // DOM under dnd-kit while its drop animation is still interpolating.
  const [localPinned, setLocalPinned] = useState<PinnedItem[]>(pinnedItems);
  const isDraggingRef = useRef(false);
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalPinned(pinnedItems);
    }
  }, [pinnedItems]);

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      isDraggingRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = localPinned.findIndex((p) => p.id === active.id);
      const newIndex = localPinned.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(localPinned, oldIndex, newIndex);
      setLocalPinned(reordered);
      reorderPins.mutate(reordered);
    },
    [localPinned, reorderPins],
  );

  // Global "C" shortcut: opens whichever create mode the user landed on last
  // (agent vs manual), persisted in useCreateModeStore. The mode switch lives
  // inside both modal footers so users can flip without remembering which
  // shortcut goes where — `c` always means "open the create flow I prefer".
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "c" && e.key !== "C") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement)?.isContentEditable;
      if (isEditable) return;
      if (useModalStore.getState().modal) return;
      e.preventDefault();
      const lastMode = useCreateModeStore.getState().lastMode;
      if (lastMode === "manual") {
        // Auto-fill project when on a project detail page (manual form only —
        // agent mode lets the agent infer project from the prompt).
        const projectMatch = pathname.match(/^\/[^/]+\/projects\/([^/]+)$/);
        const data = projectMatch ? { project_id: projectMatch[1] } : undefined;
        useModalStore.getState().open("create-issue", data);
      } else {
        useModalStore.getState().open("quick-create-issue");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pathname]);

  return (
      <Sidebar variant="inset">
        {topSlot}
        {/* Local user identity */}
        <SidebarHeader className={cn("py-3", headerClassName)} style={headerStyle}>
          <SidebarMenu>
            <SidebarMenuItem>
              <AppLink
                href={p.settings()}
                className="group/identity flex h-12 items-center gap-3 rounded-lg px-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60"
                aria-label="当前用户 — 进入设置"
              >
                <img
                  src={resolveUserAvatarUrl(user?.avatar_url, user?.name)}
                  alt={user?.name ?? "本地用户"}
                  className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border/40"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold leading-tight">
                    {user?.name?.trim() || "本地用户"}
                  </div>
                  {roleCard ? (
                    // 用户已填身份卡 — 第二行用 muted 颜色降权重，让名字主导。
                    <div className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
                      {roleCard}
                    </div>
                  ) : (
                    // 没填身份卡时不再重复 workspace 名（永远是 Fairy）。
                    // 给一个低调的提示 + 入口，hover 才显，避免视觉噪声。
                    <div className="mt-0.5 truncate text-xs leading-tight text-muted-foreground/70 opacity-0 transition-opacity group-hover/identity:opacity-100">
                      添加身份卡 →
                    </div>
                  )}
                </div>
              </AppLink>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarMenu>
            {searchSlot && (
              <SidebarMenuItem>
                {searchSlot}
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarHeader>

        {/* Navigation — 客厅化三入口 */}
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {livingRoomNav.map((item) => {
                  const href = p[item.key]();
                  const isWorkbench = item.key === "workbench";
                  // 客厅入口：pathname 匹配 /workbench 或 /agents 都算 active
                  const isActive = isNavActive(pathname, href);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={<AppLink href={href} />}
                        className="text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                      >
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {/* 客厅入口展开后显示 pinned 快捷项 */}
                      {isWorkbench && isActive && localPinned.length > 0 && (
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                          <SortableContext items={localPinned.map((pin) => pin.id)} strategy={verticalListSortingStrategy}>
                            <SidebarMenu className="mt-0.5 ml-4 gap-0">
                              {localPinned.map((pin: PinnedItem) => (
                                <PinRow
                                  key={pin.id}
                                  pin={pin}
                                  href={pin.item_type === "issue" ? p.issueDetail(pin.item_id) : p.projectWorkspaceDetail(pin.item_id)}
                                  pathname={pathname}
                                  onUnpin={() => deletePin.mutate({ itemType: pin.item_type, itemId: pin.item_id })}
                                  wsId={wsId ?? ""}
                                />
                              ))}
                            </SidebarMenu>
                          </SortableContext>
                        </DndContext>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* 设置入口：最弱视觉权重，置于底部 */}
        <SidebarFooter className="p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isNavActive(pathname, p.settings())}
                render={<AppLink href={p.settings()} />}
                className="text-muted-foreground/60 hover:not-data-active:bg-sidebar-accent/50 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground text-xs"
              >
                <Leaf className="size-3.5" />
                <span>设置</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="flex justify-end mt-1">
            <HelpLauncher />
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
  );
}
