"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, Server } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { api } from "@multica/core/api";
import type {
  AgentRuntime,
  CreateAgentRequest,
} from "@multica/core/types";
import { runtimeListOptions, runtimeKeys } from "@multica/core/runtimes/queries";
import { useUpdatableRuntimeIds } from "@multica/core/runtimes/hooks";
import { deriveRuntimeHealth } from "@multica/core/runtimes";
import { useWSEvent } from "@multica/core/realtime";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  memberListOptions,
  workspaceKeys,
} from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { Input } from "@multica/ui/components/ui/input";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { PageHeader } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { CreateAgentDialog } from "../../agents/components/create-agent-dialog";
import { ConnectRemoteDialog } from "./connect-remote-dialog";
import { RuntimeList } from "./runtime-list";

type RuntimeFilter = "mine" | "all";
type HealthFilter = "all" | "online" | "recently_lost" | "offline" | "about_to_gc";

const HEALTH_ORDER: HealthFilter[] = [
  "all",
  "online",
  "recently_lost",
  "offline",
  "about_to_gc",
];

export const runtimePageSubtitle = "扫描本机和外部能力来源，按状态快速定位。";

export const runtimePrimarySurface = {
  title: "能力池",
  primaryCta: "添加能力来源",
  controls: ["搜索", "范围", "状态筛选"],
} as const;

export const runtimeStatusFilterCopy = ["全部", "在线", "刚刚断开", "离线", "即将清理"] as const;

export const runtimeDangerConfirmations = {
  runtimeDelete: "alert-dialog",
} as const;

// Single source of truth for the 4-state chip visuals + tooltip copy.
// Thresholds come from `deriveRuntimeHealth`: 45s heartbeat window (server
// sweeper), 5 min "recently lost" cutoff, 6 day "about_to_gc" trigger,
// 7 day hard GC. Wording leans on what the user should *do*, not the
// internals of the sweeper — those live in the redesign doc.
const HEALTH_CHIP: Record<
  Exclude<HealthFilter, "all">,
  { label: string; dot: string; description: string }
> = {
  online: {
    label: "在线",
    dot: "bg-success",
    description: "最近 45 秒内收到心跳，可以绑定智能体并分发任务。",
  },
  recently_lost: {
    label: "刚刚断开",
    dot: "bg-warning",
    description: "5 分钟内失去联系，通常是短暂网络波动。",
  },
  offline: {
    label: "离线",
    dot: "bg-muted-foreground/40",
    description: "超过 5 分钟没有心跳。请重启本地守护进程或检查能力来源。",
  },
  about_to_gc: {
    label: "即将清理",
    dot: "bg-destructive",
    description: "已离线 6 天以上。如不恢复，7 天后会自动清理。",
  },
};

interface RuntimesPageProps {
  /** Desktop-only slot rendered above the runtimes table (e.g. local daemon card) */
  topSlot?: React.ReactNode;
  /**
   * Desktop-only signal: the bundled daemon is still booting / hasn't
   * registered with the server yet. Forwarded so the empty state can show
   * a "starting" indicator instead of the static "register a runtime" hint
   * during the boot window. Web omits this.
   */
  bootstrapping?: boolean;
}

// Re-render every 30s so derived health (recently_lost → offline transitions)
// catches up even when no underlying query data has changed.
function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function RuntimesPage({ topSlot, bootstrapping }: RuntimesPageProps = {}) {
  const isLoading = useAuthStore((s) => s.isLoading);
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const [scope, setScope] = useState<RuntimeFilter>("mine");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [search, setSearch] = useState("");
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntime | null>(null);

  // One unified cache per workspace: scope (Mine/All) is a view filter, not
  // a fetch dimension. Splitting on owner used to give us two TanStack cache
  // slots holding independent snapshots of the same runtime — switching scope
  // surfaced stale `last_seen_at` from whichever slot was older.
  const { data: runtimes = [], isLoading: fetching } = useQuery(
    runtimeListOptions(wsId),
  );
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  const handleDaemonEvent = useCallback(() => {
    qc.invalidateQueries({ queryKey: runtimeKeys.all(wsId) });
  }, [qc, wsId]);
  useWSEvent("daemon:register", handleDaemonEvent);

  const updatableIds = useUpdatableRuntimeIds(wsId);
  const now = useNowTick();

  // Apply scope first, then everything downstream (health counts, list filter)
  // operates on the post-scope set — so chip counts and filter results stay
  // consistent with what the user sees.
  const scopedRuntimes = useMemo(() => {
    if (scope !== "mine") return runtimes;
    if (!currentUserId) return [];
    return runtimes.filter((r) => r.owner_id === currentUserId);
  }, [runtimes, scope, currentUserId]);

  const healthCounts = useMemo(() => {
    const counts: Record<Exclude<HealthFilter, "all">, number> = {
      online: 0,
      recently_lost: 0,
      offline: 0,
      about_to_gc: 0,
    };
    for (const r of scopedRuntimes) {
      counts[deriveRuntimeHealth(r, now)] += 1;
    }
    return counts;
  }, [scopedRuntimes, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedRuntimes.filter((r) => {
      if (healthFilter !== "all") {
        if (deriveRuntimeHealth(r, now) !== healthFilter) return false;
      }
      if (q) {
        const haystack = `${r.name} ${r.provider} ${r.device_info ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [scopedRuntimes, healthFilter, search, now]);

  const handleCreateAgent = async (data: CreateAgentRequest) => {
    const agent = await api.createAgent(data);
    setAgentRuntime(null);
    await qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
    navigation.push(paths.agentDetail(agent.id));
  };

  if (isLoading || fetching) return <RuntimesPageSkeleton />;

  const totalCount = runtimes.length;
  const scopedTotal = scopedRuntimes.length;
  const showEmpty = totalCount === 0 && !bootstrapping;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeaderBar
        totalCount={totalCount}
        onConnectRemote={() => setShowConnectDialog(true)}
        onRefresh={() => {
          qc.invalidateQueries({ queryKey: runtimeKeys.all(wsId) });
        }}
        refreshing={fetching}
      />

      <div className="flex flex-1 min-h-0 flex-col gap-4 p-6">
        {topSlot}

        {showEmpty ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState onConnectRemote={() => setShowConnectDialog(true)} />
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
            <CardToolbar
              search={search}
              setSearch={setSearch}
              scope={scope}
              setScope={setScope}
            />
            <FilterChipsRow
              healthFilter={healthFilter}
              setHealthFilter={setHealthFilter}
              healthCounts={healthCounts}
              total={scopedTotal}
            />
            {filtered.length === 0 ? (
              <NoMatchesState search={search} healthFilter={healthFilter} scope={scope} bootstrapping={bootstrapping} />
            ) : (
              <RuntimeList
                runtimes={filtered}
                updatableIds={updatableIds}
                now={now}
                onCreateAgent={setAgentRuntime}
              />
            )}
          </div>
        )}
      </div>

      {showConnectDialog && (
        <ConnectRemoteDialog onClose={() => setShowConnectDialog(false)} />
      )}

      {agentRuntime && (
        <CreateAgentDialog
          runtimes={runtimes}
          members={members}
          currentUserId={currentUserId ?? null}
          initialRuntimeId={agentRuntime.id}
          onClose={() => setAgentRuntime(null)}
          onCreate={handleCreateAgent}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header bar — minimal: only icon + title + count, matching Skills.
// Page-level actions (Search, scope, filter) live in the card below.
// ---------------------------------------------------------------------------

function PageHeaderBar({
  totalCount,
  onConnectRemote,
  onRefresh,
  refreshing,
}: {
  totalCount: number;
  onConnectRemote: () => void;
  // Manual refresh — runtime list updates are infrequent (daemon
  // restart / new connect), so we don't poll. The button covers the
  // rare case where a daemon:register WS event miss leaves the list
  // stale.
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <PageHeader className="justify-between px-5">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">能力池</h1>
        {totalCount > 0 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
            {totalCount}
          </span>
        )}
        <p className="ml-2 hidden text-xs text-muted-foreground md:block">
          {runtimePageSubtitle}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRefresh}
          disabled={refreshing}
          title="刷新能力池"
          className="size-7 p-0"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </Button>
        <Button type="button" size="sm" onClick={onConnectRemote}>
          <Plus className="h-3 w-3" />
          添加能力来源
        </Button>
      </div>
    </PageHeader>
  );
}

// ---------------------------------------------------------------------------
// Intro block — sits between the page header and the table card. Mirrors
// Skills' two-paragraph pattern: a one-liner plus a brand-accented callout
// pinning down a single non-obvious fact about the surface.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Card toolbar — search + scope toggle + live indicator. Skills puts its
// search and filter buttons here; we follow the same convention so the card
// owns its own interactions.
// ---------------------------------------------------------------------------

function CardToolbar({
  search,
  setSearch,
  scope,
  setScope,
}: {
  search: string;
  setSearch: (v: string) => void;
  scope: RuntimeFilter;
  setScope: (v: RuntimeFilter) => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索能力来源…"
          className="h-8 w-64 pl-8 text-sm"
        />
      </div>
      <ScopeSegment value={scope} onChange={setScope} />
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="ml-auto inline-flex cursor-default select-none items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative inline-flex h-2 w-2 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              实时
            </div>
          }
        />
        <TooltipContent side="top">
          实时更新 · 本地守护进程会自动刷新能力状态
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function ScopeSegment({
  value,
  onChange,
}: {
  value: RuntimeFilter;
  onChange: (v: RuntimeFilter) => void;
}) {
  // Mine first — that's the default selection and the more frequent
  // scope (your own runtimes), so it lives in the leading slot. Mirrors
  // the Agents page convention.
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      <button
        onClick={() => onChange("mine")}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          value === "mine"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        本机
      </button>
      <button
        onClick={() => onChange("all")}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          value === "all"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        全部
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter chips — 4 health states + "All", each with a tooltip explaining
// what the state actually means in operational terms. Counts come from the
// pre-filter set so users can see "what would happen" before clicking.
// ---------------------------------------------------------------------------

function FilterChipsRow({
  healthFilter,
  setHealthFilter,
  healthCounts,
  total,
}: {
  healthFilter: HealthFilter;
  setHealthFilter: (v: HealthFilter) => void;
  healthCounts: Record<Exclude<HealthFilter, "all">, number>;
  total: number;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
      {HEALTH_ORDER.map((key) => {
        const count = key === "all" ? total : healthCounts[key];
        const visual = key === "all" ? null : HEALTH_CHIP[key];
        const description =
          key === "all" ? "当前视图中的全部能力来源" : visual!.description;
        return (
          <HealthChip
            key={key}
            active={healthFilter === key}
            onClick={() => setHealthFilter(key)}
            label={visual?.label ?? "全部"}
            count={count}
            dotClass={visual?.dot}
            description={description}
          />
        );
      })}
    </div>
  );
}

// Mirrors Agents' `PresenceChip` — same `Button outline + size sm` shell so
// any future polish to the chip token cascades to both surfaces. The active
// state uses `bg-accent text-accent-foreground hover:bg-accent/80`, matching
// Skills' filter chip selection.
function HealthChip({
  active,
  onClick,
  label,
  count,
  dotClass,
  description,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dotClass?: string;
  description: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            onClick={onClick}
            className={
              active
                ? "bg-accent text-accent-foreground hover:bg-accent/80"
                : "text-muted-foreground"
            }
          >
            {dotClass && (
              <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
            )}
            <span>{label}</span>
            <span className="font-mono tabular-nums text-muted-foreground/70">
              {count}
            </span>
          </Button>
        }
      />
      <TooltipContent side="top">{description}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Empty state — shown when zero runtimes have ever registered in this
// workspace. Different from "filter matches nothing" (NoMatchesState).
// ---------------------------------------------------------------------------

function EmptyState({ onConnectRemote }: { onConnectRemote: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Server className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-semibold">暂无能力来源</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        桌面版会自动扫描 Claude Code、Codex、Gemini、Cursor 等本机已登录能力。外部 API Provider 会在接入钥匙串后开放绑定。
      </p>
      <Button
        type="button"
        size="sm"
        onClick={onConnectRemote}
        className="mt-5"
      >
        <Plus className="h-3 w-3" />
        添加能力来源
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No matches state — runtimes exist but the current filter combination
// hides all of them. Keeps the user oriented by reflecting *which* filters
// are in play.
// ---------------------------------------------------------------------------

function NoMatchesState({
  search,
  healthFilter,
  scope,
  bootstrapping,
}: {
  search: string;
  healthFilter: HealthFilter;
  scope: RuntimeFilter;
  bootstrapping?: boolean;
}) {
  if (bootstrapping) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <Server className="h-8 w-8 animate-pulse text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">正在启动本机能力扫描…</p>
        <p className="max-w-xs text-xs text-muted-foreground/70">
          通常只需要几秒钟。守护进程正在识别本机可用的 CLI 能力。
        </p>
      </div>
    );
  }

  const hasSearch = search.length > 0;
  const hasHealthFilter = healthFilter !== "all";
  const hasScope = scope === "mine";

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center text-muted-foreground">
      <Search className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm">无匹配项</p>
      <p className="max-w-xs text-xs">
        {hasSearch
          ? `没有匹配“${search}”的能力来源${hasHealthFilter || hasScope ? "（当前筛选内）" : ""}。`
          : "没有能力来源匹配当前筛选。"}{" "}
        可以放宽范围或清除筛选。
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton — laid out the same as the real page (header + intro
// + card) so the layout doesn't jump on first paint.
// ---------------------------------------------------------------------------

function RuntimesPageSkeleton() {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeader className="justify-between px-5">
        <Skeleton className="h-4 w-24" />
      </PageHeader>
      <div className="flex flex-1 min-h-0 flex-col gap-4 p-6">
        <div className="space-y-3 pl-4">
          <Skeleton className="h-5 w-full max-w-2xl rounded-md" />
          <Skeleton className="h-14 w-full max-w-3xl rounded-md" />
        </div>
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <Skeleton className="h-8 w-64 rounded-md" />
            <Skeleton className="h-7 w-20 rounded-md" />
          </div>
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RuntimesPage;
export type { RuntimesPageProps };
