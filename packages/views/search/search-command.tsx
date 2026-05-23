"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  SearchIcon,
  Bot,
  Monitor,
  Network,
  Moon,
  Sun,
  Settings,
  Building2,
  Compass,
  Lightbulb,
  Route,
  Brain,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { useQueries, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SearchIssueResult, SearchProjectResult } from "@multica/core/types";
import { api } from "@multica/core/api";
import { useRecentIssuesStore } from "@multica/core/issues/stores";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { useWorkspaceId } from "@multica/core";
import { paths, useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import type { WorkspacePaths } from "@multica/core/paths";
import { useModalStore } from "@multica/core/modals";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { StatusIcon } from "../issues/components";
import { ProjectIcon } from "../projects/components/project-icon";
import { STATUS_CONFIG } from "@multica/core/issues/config";
import { PROJECT_STATUS_CONFIG } from "@multica/core/projects/config";
import type { ProjectStatus } from "@multica/core/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@multica/ui/components/ui/dialog";
import { useTheme } from "@multica/ui/components/common/theme-provider";
import { useNavigation } from "../navigation";
import { useSearchStore } from "./search-store";

function HighlightText({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    if (!query.trim()) return [{ text, highlight: false }];
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const result: { text: string; highlight: boolean }[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ text: text.slice(lastIndex, match.index), highlight: false });
      }
      result.push({ text: match[0], highlight: true });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      result.push({ text: text.slice(lastIndex), highlight: false });
    }
    return result.length > 0 ? result : [{ text, highlight: false }];
  }, [text, query]);

  return (
    <>
      {parts.map((part, i) =>
        part.highlight ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-900/60 text-inherit rounded-sm">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

// Nav items reference WorkspacePaths method names so they can be resolved
// against the current workspace slug at render time (see SearchCommand body).
// Only parameterless paths are valid nav destinations.
type NavKey =
  | "workbench"
  | "ideas"
  | "councils"
  | "missions"
  | "issues"
  | "explorations"
  | "projects"
  | "agents"
  | "teams"
  | "runtimes"
  | "skills"
  | "settings";

interface NavPage {
  key: NavKey;
  label: string;
  icon: LucideIcon;
  keywords: string[];
}

const navPages: NavPage[] = [
  { key: "workbench", label: "原点工作台", icon: Compass, keywords: ["origin", "workbench", "home", "原点", "工作台", "首页"] },
  { key: "ideas", label: "想法池", icon: Lightbulb, keywords: ["idea", "ideas", "capture", "想法", "灵感", "捕捉"] },
  { key: "missions", label: "任务中枢", icon: Network, keywords: ["missions", "mission", "agent", "任务中枢", "派发", "智能体"] },
  { key: "agents", label: "智能体", icon: Bot, keywords: ["agents", "bots", "ai", "智能体", "代理", "记忆"] },
  { key: "councils", label: "多角色议事", icon: Users, keywords: ["council", "meeting", "session", "会议室", "会议", "临时讨论", "多角色议事"] },
  { key: "explorations", label: "分叉探索", icon: Route, keywords: ["exploration", "branch", "fork", "分叉", "探索", "方案"] },
  { key: "runtimes", label: "能力池", icon: Monitor, keywords: ["runtimes", "environments", "能力池", "运行环境", "环境"] },
  { key: "skills", label: "技能", icon: Brain, keywords: ["skills", "library", "技能", "能力库"] },
  { key: "settings", label: "设置", icon: Settings, keywords: ["settings", "config", "preferences", "设置", "配置"] },
];

type ThemeValue = "light" | "dark" | "system";

interface CommandItem {
  key: string;
  label: string;
  icon: LucideIcon;
  keywords: string[];
  trailing?: React.ReactNode;
  onSelect: () => void;
}

interface SearchResults {
  issues: SearchIssueResult[];
  projects: SearchProjectResult[];
}

export function SearchCommand() {
  const { push, pathname, getShareableUrl } = useNavigation();
  const open = useSearchStore((s) => s.open);
  const setOpen = useSearchStore((s) => s.setOpen);
  const recentItems = useRecentIssuesStore((s) => s.items);
  const wsId = useWorkspaceId();
  const p: WorkspacePaths = useWorkspacePaths();
  const { theme, setTheme } = useTheme();
  const currentWorkspace = useCurrentWorkspace();
  const { data: workspaces = [] } = useQuery(workspaceListOptions());

  // Resolve each recent issue via its cached detail entry. Recent items are
  // typically already in the detail cache because the user has opened them;
  // if not, this triggers a lookup per id so Recent never depends on whether
  // the issue falls inside the paginated list cache.
  const recentDetailQueries = useQueries({
    queries: recentItems.map((item) => issueDetailOptions(wsId, item.id)),
  });
  const recentIssues = useMemo(
    () =>
      recentDetailQueries.flatMap((q) => (q.data ? [q.data] : [])),
    [recentDetailQueries],
  );

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ issues: [], projects: [] });
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return navPages.filter(
      (page) =>
        page.label.toLowerCase().includes(q) ||
        page.keywords.some((kw) => kw.includes(q)),
    );
  }, [query]);

  // Detect if current route is an issue detail page — /{slug}/issues/{id}.
  // Falls back to null on any other route; used to gate issue-specific commands.
  const currentIssueId = useMemo(() => {
    const match = pathname.match(/\/issues\/([^/]+)$/);
    const raw = match?.[1];
    return raw ? decodeURIComponent(raw) : null;
  }, [pathname]);
  const { data: currentIssue = null } = useQuery({
    ...issueDetailOptions(wsId, currentIssueId ?? ""),
    enabled: !!currentIssueId,
  });

  const commands = useMemo<CommandItem[]>(() => {
    const activeThemeCheck = (value: ThemeValue) =>
      theme === value ? (
        <Check
          aria-label="当前主题"
          className="ml-auto size-4 shrink-0 text-muted-foreground"
        />
      ) : undefined;

    const items: CommandItem[] = [
      {
        key: "new-mission",
        label: "新建 Mission",
        icon: Plus,
        keywords: ["new", "mission", "create", "add", "新建", "任务中枢", "创建"],
        onSelect: () => {
          push(p.missions());
          setOpen(false);
        },
      },
      {
        key: "new-project",
        label: "新建项目",
        icon: Plus,
        keywords: ["new", "project", "create", "add", "新建", "项目", "创建"],
        onSelect: () => {
          useModalStore.getState().open("create-project");
          setOpen(false);
        },
      },
    ];

    if (currentIssue) {
      const identifier = currentIssue.identifier;
      items.push(
        {
          key: "copy-issue-link",
          label: "复制任务链接",
          icon: Link2,
          keywords: ["copy", "link", "share", "url", "复制", "链接", identifier.toLowerCase()],
          onSelect: () => {
            const url = getShareableUrl ? getShareableUrl(pathname) : window.location.href;
            void navigator.clipboard.writeText(url);
            toast.success("链接已复制");
            setOpen(false);
          },
        },
        {
          key: "copy-issue-identifier",
          label: `复制编号（${identifier}）`,
          icon: Copy,
          keywords: ["copy", "id", "identifier", "复制", "编号", identifier.toLowerCase()],
          onSelect: () => {
            void navigator.clipboard.writeText(identifier);
            toast.success(`已复制 ${identifier}`);
            setOpen(false);
          },
        },
      );
    }

    items.push(
      {
        key: "theme-light",
        label: "切换到浅色主题",
        icon: Sun,
        keywords: ["light", "theme", "appearance", "mode", "bright", "浅色", "主题", "外观"],
        trailing: activeThemeCheck("light"),
        onSelect: () => {
          setTheme("light");
          setOpen(false);
        },
      },
      {
        key: "theme-dark",
        label: "切换到深色主题",
        icon: Moon,
        keywords: ["dark", "theme", "appearance", "mode", "night", "深色", "主题", "外观"],
        trailing: activeThemeCheck("dark"),
        onSelect: () => {
          setTheme("dark");
          setOpen(false);
        },
      },
      {
        key: "theme-system",
        label: "跟随系统主题",
        icon: Monitor,
        keywords: ["system", "theme", "appearance", "mode", "auto", "系统", "主题", "外观", "自动"],
        trailing: activeThemeCheck("system"),
        onSelect: () => {
          setTheme("system");
          setOpen(false);
        },
      },
    );

    return items;
  }, [currentIssue, getShareableUrl, pathname, setOpen, setTheme, theme]);

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    // No query: only surface the primary creation action. Other commands
    // (theme switches, copy actions, New Project) are revealed as the user
    // types, leaving the empty-state space to Recent.
    if (!q) return commands.filter((c) => c.key === "new-mission");
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.keywords.some((kw) => kw.includes(q)),
    );
  }, [commands, query]);

  // Only show workspaces different from the current one, and only after the
  // user types >=2 chars — one char would match everything (e.g. "w").
  const filteredWorkspaces = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const others = workspaces.filter((w) => w.id !== currentWorkspace?.id);
    const wantsAll =
      q.length >= 2 && ("workspace".startsWith(q) || "switch".startsWith(q) || "工作区".startsWith(q) || "切换".startsWith(q));
    return others.filter(
      (w) =>
        wantsAll ||
        w.name.toLowerCase().includes(q) ||
        w.slug.toLowerCase().includes(q),
    );
  }, [workspaces, currentWorkspace?.id, query]);

  const hasResults = results.issues.length > 0 || results.projects.length > 0;

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        useSearchStore.getState().toggle();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close on single ESC — capture phase fires before base-ui Dialog's handlers
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleEsc, true);
    return () => document.removeEventListener("keydown", handleEsc, true);
  }, [open, setOpen]);

  // Cleanup debounce/abort on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults({ issues: [], projects: [] });
      setIsLoading(false);
    }
  }, [open]);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!q.trim()) {
      setResults({ issues: [], projects: [] });
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const [issueRes, projectRes] = await Promise.all([
          api.searchIssues({
            q: q.trim(),
            limit: 20,
            include_closed: true,
            signal: controller.signal,
          }),
          api.searchProjects({
            q: q.trim(),
            limit: 10,
            include_closed: true,
            signal: controller.signal,
          }),
        ]);
        if (!controller.signal.aborted) {
          setResults({
            issues: issueRes.issues,
            projects: projectRes.projects,
          });
          setIsLoading(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 300);
  }, []);

  const handleValueChange = useCallback(
    (value: string) => {
      setQuery(value);
      search(value);
    },
    [search],
  );

  const handleSelect = useCallback(
    (value: string) => {
      setOpen(false);
      if (value.startsWith("project:")) {
        // value is "project:<id>" — slice off the 8-char prefix to extract the id.
        push(p.projectDetail(value.slice(8)));
      } else {
        push(p.issueDetail(value));
      }
    },
    [push, setOpen, p],
  );

  const handlePageSelect = useCallback(
    (key: NavKey) => {
      setOpen(false);
      push(p[key]());
    },
    [push, setOpen, p],
  );

  const handleSwitchWorkspace = useCallback(
    (slug: string) => {
      push(paths.workspace(slug).root());
      setOpen(false);
    },
    [push, setOpen],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        finalFocus={false}
        className="top-[20%] translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-xl!"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>搜索</DialogTitle>
          <DialogDescription>
            搜索页面、任务和项目
          </DialogDescription>
        </DialogHeader>
        <CommandPrimitive
          shouldFilter={false}
          className="flex size-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground"
        >
          {/* Search input */}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              placeholder="输入命令或搜索..."
              value={query}
              onValueChange={handleValueChange}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
              ESC
            </kbd>
          </div>

          {/* Results list */}
          <CommandPrimitive.List className="max-h-[min(400px,50vh)] overflow-y-auto overflow-x-hidden">
            {/* Pages section — only shown when query matches */}
            {filteredPages.length > 0 && (
              <CommandPrimitive.Group className="p-2">
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  页面
                </div>
                {filteredPages.map((page) => (
                  <CommandPrimitive.Item
                    key={page.key}
                    value={`page:${page.key}`}
                    onSelect={() => handlePageSelect(page.key)}
                    className="flex cursor-default select-none items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent"
                  >
                    <page.icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      <HighlightText text={page.label} query={query} />
                    </span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}

            {/* Commands section — New Issue / New Project / Copy link / Theme, only shown when query matches */}
            {filteredCommands.length > 0 && (
              <CommandPrimitive.Group className="p-2">
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  命令
                </div>
                {filteredCommands.map((cmd) => (
                  <CommandPrimitive.Item
                    key={cmd.key}
                    value={`command:${cmd.key}`}
                    onSelect={cmd.onSelect}
                    className="flex cursor-default select-none items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent"
                  >
                    <cmd.icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      <HighlightText text={cmd.label} query={query} />
                    </span>
                    {cmd.trailing}
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}

            {/* Local spaces section — compatibility layer for the old workspace model. */}
            {filteredWorkspaces.length > 0 && (
              <CommandPrimitive.Group className="p-2">
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  切换本地空间
                </div>
                {filteredWorkspaces.map((ws) => (
                  <CommandPrimitive.Item
                    key={ws.id}
                    value={`workspace:${ws.id}`}
                    onSelect={() => handleSwitchWorkspace(ws.slug)}
                    className="flex cursor-default select-none items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent"
                  >
                    <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      <HighlightText text={ws.name} query={query} />
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground truncate">
                      {ws.slug}
                    </span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}

            {isLoading && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isLoading &&
              query.trim() &&
              !hasResults &&
              filteredPages.length === 0 &&
              filteredCommands.length === 0 &&
              filteredWorkspaces.length === 0 && (
                <CommandPrimitive.Empty className="py-10 text-center text-sm text-muted-foreground">
                  没有找到结果。
                </CommandPrimitive.Empty>
              )}

            {!isLoading && results.projects.length > 0 && (
              <CommandPrimitive.Group
                heading="项目"
                className="p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {results.projects.map((project) => (
                  <CommandPrimitive.Item
                    key={`project:${project.id}`}
                    value={`project:${project.id}`}
                    onSelect={handleSelect}
                    className="flex cursor-default select-none flex-col gap-1 rounded-lg px-3 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent"
                  >
                    <div className="flex items-center gap-2.5">
                      <ProjectIcon project={project} size="md" />
                      <span className="truncate">
                        <HighlightText text={project.title} query={query} />
                      </span>
                      <span
                        className={`ml-auto text-xs shrink-0 ${PROJECT_STATUS_CONFIG[project.status as ProjectStatus]?.color ?? "text-muted-foreground"}`}
                      >
                        {PROJECT_STATUS_CONFIG[project.status as ProjectStatus]?.label ?? project.status}
                      </span>
                    </div>
                    {project.match_source === "description" &&
                      project.matched_snippet && (
                        <div className="flex items-start gap-2 pl-[26px]">
                          <span className="text-xs text-muted-foreground truncate">
                            <HighlightText
                              text={project.matched_snippet}
                              query={query}
                            />
                          </span>
                        </div>
                      )}
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}

            {!isLoading && results.issues.length > 0 && (
              <CommandPrimitive.Group
                heading="任务"
                className="p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {results.issues.map((issue) => (
                  <CommandPrimitive.Item
                    key={issue.id}
                    value={issue.id}
                    onSelect={handleSelect}
                    className="flex cursor-default select-none flex-col gap-1 rounded-lg px-3 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent"
                  >
                    <div className="flex items-center gap-2.5">
                      <StatusIcon
                        status={issue.status}
                        className="size-4 shrink-0"
                      />
                      <span className="text-xs text-muted-foreground shrink-0">
                        {issue.identifier}
                      </span>
                      <span className="truncate">
                        <HighlightText text={issue.title} query={query} />
                      </span>
                      <span
                        className={`ml-auto text-xs shrink-0 ${STATUS_CONFIG[issue.status].iconColor}`}
                      >
                        {STATUS_CONFIG[issue.status].label}
                      </span>
                    </div>
                    {issue.match_source === "comment" &&
                      issue.matched_snippet && (
                        <div className="flex items-start gap-2 pl-[26px]">
                          <MessageSquare className="size-3 shrink-0 text-muted-foreground mt-0.5" />
                          <span className="text-xs text-muted-foreground truncate">
                            <HighlightText
                              text={issue.matched_snippet}
                              query={query}
                            />
                          </span>
                        </div>
                      )}
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}

            {!isLoading && !query.trim() && recentIssues.length > 0 && (
              <CommandPrimitive.Group className="p-2">
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <Clock className="size-3" />
                  <span>最近</span>
                </div>
                {recentIssues.map((item) => (
                  <CommandPrimitive.Item
                    key={item.id}
                    value={item.id}
                    onSelect={handleSelect}
                    className="flex cursor-default select-none items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent"
                  >
                    <StatusIcon
                      status={item.status}
                      className="size-4 shrink-0"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">
                      {item.identifier}
                    </span>
                    <span className="truncate">{item.title}</span>
                    <span
                      className={`ml-auto text-xs shrink-0 ${STATUS_CONFIG[item.status]?.iconColor ?? ""}`}
                    >
                      {STATUS_CONFIG[item.status]?.label ?? ""}
                    </span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}

            {!isLoading && !query.trim() && recentIssues.length === 0 && (
              <div className="px-5 py-4 text-center text-xs text-muted-foreground">
                输入内容搜索任务和项目
              </div>
            )}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
