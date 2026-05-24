"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  Bot,
  Plus,
  Search,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, AgentRuntime, CreateAgentRequest } from "@multica/core/types";
import {
  type AgentAvailability,
  agentRunCounts30dOptions,
  summarizeActivityWindow,
  useWorkspaceActivityMap,
  useWorkspacePresenceMap,
} from "@multica/core/agents";
import { api } from "@multica/core/api";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  agentListOptions,
  memberListOptions,
  workspaceKeys,
} from "@multica/core/workspace/queries";
import { runtimeListOptions } from "@multica/core/runtimes";
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { useNavigation } from "../../navigation";
import { PageHeader } from "../../layout/page-header";
import { availabilityConfig, availabilityOrder } from "../presence";
import { AgentCard } from "./agent-card";
import { CreateAgentDialog } from "./create-agent-dialog";
import type { AgentRow } from "./agent-columns";

// Filter axes:
//
//   View         = active vs archived dataset. Archived is low-frequency,
//                  accessed through a ghost link in the toolbar.
//   Availability = "Can the agent take work right now?" — 3-state chip
//                  group (online / unstable / offline) sourced from
//                  AgentAvailability. The only chip filter we keep —
//                  the previous Workload axis was dropped because its
//                  "queued / failed / cancelled" buckets became
//                  meaningless once Failed left the workload model.
type View = "active" | "archived";
type AvailabilityFilter = "all" | AgentAvailability;

type SortKey = "recent" | "name" | "runs" | "created";
const SORT_KEYS: SortKey[] = ["recent", "name", "runs", "created"];
const SORT_LABEL: Record<SortKey, string> = {
  recent: "最近活动",
  name: "名称",
  runs: "运行次数最多",
  created: "最近创建",
};

export const agentPageSubtitle = "配置智能体角色、运行来源和工作状态。";

export const agentPrimarySurface = {
  title: "智能体",
  primaryCta: "新建智能体",
  controls: ["搜索", "状态筛选", "排序"],
} as const;

export const agentListLayout = "badge-grid" as const;
export const agentBadgeGridClassName =
  "grid grid-cols-[repeat(auto-fill,minmax(21rem,21rem))] justify-center gap-4" as const;

export function AgentsPage() {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const {
    data: agents = [],
    isLoading,
    error: listError,
    refetch: refetchList,
  } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(
    runtimeListOptions(wsId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: runCountsRaw = [] } = useQuery(agentRunCounts30dOptions(wsId));

  // Single source of truth for derived agent state. The hook owns the
  // 30s tick + the runtime/null/task orchestration; the page only reads
  // the resulting Maps. Replaces the 24-line useMemo presenceMap +
  // 12-line activityMap that lived here previously.
  const { byAgent: presenceMap } = useWorkspacePresenceMap(wsId);
  const { byAgent: activityMap } = useWorkspaceActivityMap(wsId);

  const [view, setView] = useState<View>("active");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<AvailabilityFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  // When set, the Create dialog opens pre-populated with this agent's
  // config — driven by the row-level "Duplicate" action. We keep this
  // separate from `showCreate` so a stray null-template doesn't open the
  // dialog: the dialog opens iff `showCreate || duplicateTemplate`.
  const [duplicateTemplate, setDuplicateTemplate] = useState<Agent | null>(
    null,
  );

  const runtimesById = useMemo(() => {
    const m = new Map<string, AgentRuntime>();
    for (const r of runtimes) m.set(r.id, r);
    return m;
  }, [runtimes]);

  const runCountsById = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runCountsRaw) m.set(r.agent_id, r.run_count);
    return m;
  }, [runCountsRaw]);

  // Layer 1a — view (active / archived).
  const inView = useMemo(
    () =>
      agents.filter((a) =>
        view === "archived" ? !!a.archived_at : !a.archived_at,
      ),
    [agents, view],
  );

  // Final cut — availability chip + search.
  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inView.filter((a) => {
      // Availability chip filter only applies to the Active view —
      // archived agents have no presence to match against.
      if (view === "active" && availabilityFilter !== "all") {
        const detail = presenceMap.get(a.id);
        if (detail?.availability !== availabilityFilter) return false;
      }
      if (q) {
        const skillMatches = a.skills.some((s) =>
          `${s.name} ${s.description ?? ""}`.toLowerCase().includes(q),
        );
        if (
          !a.name.toLowerCase().includes(q) &&
          !(a.description ?? "").toLowerCase().includes(q) &&
          !skillMatches
        ) {
          return false;
        }
      }
      return true;
    });
  }, [inView, view, availabilityFilter, presenceMap, search]);

  // Per-availability counts for the chip badges. Computed against
  // `inView` (ignoring the availability filter itself) so the numbers
  // reflect "if I clicked this chip, this many agents would match"
  // rather than collapsing to 0 for the unselected chips.
  const availabilityCounts = useMemo(() => {
    const counts: Record<AgentAvailability, number> = {
      online: 0,
      unstable: 0,
      offline: 0,
    };
    for (const a of inView) {
      const detail = presenceMap.get(a.id);
      if (!detail) continue;
      counts[detail.availability] += 1;
    }
    return counts;
  }, [inView, presenceMap]);

  const sortedAgents = useMemo(() => {
    const xs = [...filteredAgents];
    switch (sort) {
      case "name":
        xs.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "runs":
        xs.sort(
          (a, b) =>
            (runCountsById.get(b.id) ?? 0) - (runCountsById.get(a.id) ?? 0),
        );
        break;
      case "created":
        xs.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
        break;
      case "recent":
      default:
        // "Recent activity" prioritises 7d total completions (the same
        // window the row's sparkline shows), then 30d run count, then
        // created_at. We don't have a precise last-touched timestamp on
        // Agent today; this approximates it closely without a new column.
        xs.sort((a, b) => {
          const aSum = summarizeActivityWindow(
            activityMap.get(a.id),
            7,
          ).totalRuns;
          const bSum = summarizeActivityWindow(
            activityMap.get(b.id),
            7,
          ).totalRuns;
          if (aSum !== bSum) return bSum - aSum;
          const aRuns = runCountsById.get(a.id) ?? 0;
          const bRuns = runCountsById.get(b.id) ?? 0;
          if (aRuns !== bRuns) return bRuns - aRuns;
          return +new Date(b.created_at) - +new Date(a.created_at);
        });
        break;
    }
    return xs;
  }, [filteredAgents, sort, runCountsById, activityMap]);

  const archivedCount = useMemo(
    () => agents.filter((a) => !!a.archived_at).length,
    [agents],
  );

  const totalActiveCount = useMemo(
    () => agents.filter((a) => !a.archived_at).length,
    [agents],
  );

  // Auto-bounce out of Archived if the population empties (e.g. user
  // restored the last archived agent from another surface).
  useEffect(() => {
    if (view === "archived" && archivedCount === 0) setView("active");
  }, [view, archivedCount]);

  const handleCreate = async (
    data: CreateAgentRequest,
    skillIds?: string[],
  ) => {
    const agent = await api.createAgent(data);
    // When duplicating, carry the source agent's skill assignments over.
    // Skills aren't part of CreateAgentRequest (they're managed via
    // setAgentSkills) so the create endpoint can't take them inline; we
    // do a follow-up call. Failure here doesn't abort the duplicate —
    // the agent already exists and the user can re-attach skills from
    // the detail page.
    const skillsToAttach =
      skillIds && skillIds.length > 0
        ? skillIds
        : duplicateTemplate?.skills.map((s) => s.id) ?? [];
    if (skillsToAttach.length > 0) {
      try {
        await api.setAgentSkills(agent.id, {
          skill_ids: skillsToAttach,
        });
      } catch {
        // Surfaced softly; the agent itself is fine.
      }
    }
    setShowCreate(false);
    setDuplicateTemplate(null);
    navigation.push(paths.agentDetail(agent.id));
    qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
  };

  const handleDuplicate = useCallback((agent: Agent) => {
    setDuplicateTemplate(agent);
    setShowCreate(true);
  }, []);

  // Assemble per-row data once per render — agent + runtime + presence +
  // activity + role flags. The columns reach into `row.original` and never
  // pull their own queries, which keeps each cell a pure function.
  const agentRows = useMemo<AgentRow[]>(() => {
    return sortedAgents.map((agent) => {
      return {
        agent,
        runtime: runtimesById.get(agent.runtime_id) ?? null,
        presence: presenceMap.get(agent.id) ?? null,
        activity: activityMap.get(agent.id) ?? null,
        runCount: runCountsById.get(agent.id) ?? 0,
        canManage: true,
      };
    });
  }, [
    sortedAgents,
    runtimesById,
    presenceMap,
    activityMap,
    runCountsById,
  ]);

  // ---- Loading ----
  if (isLoading) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <PageHeaderBar totalCount={0} onCreate={() => setShowCreate(true)} />
        <div className="flex flex-1 min-h-0 flex-col gap-4 p-6">
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-2xl border bg-background">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
              <Skeleton className="h-7 w-32 rounded-md" />
              <Skeleton className="h-7 w-32 rounded-md" />
            </div>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <div
              className={`${agentBadgeGridClassName} min-h-0 flex-1 overflow-y-auto p-5`}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[18rem] rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- List request error ----
  if (listError) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <PageHeaderBar totalCount={0} onCreate={() => setShowCreate(true)} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <div>
            <p className="text-sm font-medium">无法加载智能体</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {listError instanceof Error
                ? listError.message
                : "获取智能体列表时出现问题。"}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetchList()}
          >
            重试
          </Button>
        </div>
      </div>
    );
  }

  const showEmpty = totalActiveCount === 0 && archivedCount === 0;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeaderBar
        totalCount={totalActiveCount}
        onCreate={() => setShowCreate(true)}
      />

      <div className="flex flex-1 min-h-0 flex-col gap-4 p-6">
        {showEmpty ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState onCreate={() => setShowCreate(true)} />
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
            {view === "active" ? (
              <>
                <ActiveToolbarRow
                  sort={sort}
                  setSort={setSort}
                  search={search}
                  setSearch={setSearch}
                  visibleCount={sortedAgents.length}
                  totalCount={inView.length}
                  archivedCount={archivedCount}
                  onShowArchived={() => setView("archived")}
                />
                <AvailabilityFilterRow
                  value={availabilityFilter}
                  onChange={setAvailabilityFilter}
                  counts={availabilityCounts}
                  totalCount={inView.length}
                />
              </>
            ) : (
              <ArchivedToolbarRow
                onBack={() => setView("active")}
                archivedCount={archivedCount}
                sort={sort}
                setSort={setSort}
              />
            )}

            <AgentGrid
              view={view}
              rows={agentRows}
              search={search}
              onOpen={(agent) => navigation.push(paths.agentDetail(agent.id))}
              onDuplicate={handleDuplicate}
            />
          </div>
        )}
      </div>

      {showCreate && (
        <CreateAgentDialog
          runtimes={runtimes}
          runtimesLoading={runtimesLoading}
          members={members}
          currentUserId={currentUser?.id ?? null}
          template={duplicateTemplate}
          onClose={() => {
            setShowCreate(false);
            setDuplicateTemplate(null);
          }}
          onCreate={handleCreate}
        />
      )}

    </div>
  );
}

function AgentGrid({
  view,
  rows,
  search,
  onOpen,
  onDuplicate,
}: {
  view: View;
  rows: AgentRow[];
  search: string;
  onOpen: (agent: Agent) => void;
  onDuplicate: (agent: Agent) => void;
}) {
  if (rows.length === 0 && view !== "active") {
    return <NoMatches view={view} search={search} />;
  }

  if (rows.length === 0 && search.trim()) {
    return <NoMatches view={view} search={search} />;
  }

  if (rows.length === 0 && view === "active") {
    return (
      <p className="mt-6 text-center text-sm text-muted-foreground">
        当前筛选条件下还没有智能体，可以先新建一个。
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className={agentBadgeGridClassName}>
        {rows.map((row) => (
          <AgentCard
            key={row.agent.id}
            row={row}
            onOpen={() => onOpen(row.agent)}
            onDuplicate={() => onDuplicate(row.agent)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page header — icon + title + count + create CTA. Unchanged.
// ---------------------------------------------------------------------------

function PageHeaderBar({
  totalCount,
  onCreate,
}: {
  totalCount: number;
  onCreate: () => void;
}) {
  return (
    <PageHeader className="justify-between px-5">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">智能体</h1>
        {totalCount > 0 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
            {totalCount}
          </span>
        )}
        {/* Tagline next to the title — mirrors Runtimes / Skills. Single
            sentence, hidden below md so it never collides with
            the title on narrow screens. */}
        <p className="ml-2 hidden text-xs text-muted-foreground md:block">
          {agentPageSubtitle}
        </p>
      </div>
      <Button type="button" size="sm" onClick={onCreate}>
        <Plus className="h-3 w-3" />
        新建智能体
      </Button>
    </PageHeader>
  );
}

// ---------------------------------------------------------------------------
// Active view — search + sort + archived link + live count.
// ---------------------------------------------------------------------------

function ActiveToolbarRow({
  sort,
  setSort,
  search,
  setSearch,
  visibleCount,
  totalCount,
  archivedCount,
  onShowArchived,
}: {
  sort: SortKey;
  setSort: (v: SortKey) => void;
  search: string;
  setSearch: (v: string) => void;
  visibleCount: number;
  totalCount: number;
  archivedCount: number;
  onShowArchived: () => void;
}) {
  // Layout: [Search] ......... [Show archived] [N of M] [Sort ▼]
  // Filter chips were removed (status / workload chips in this dense list
  // gain less than they cost), so the toolbar collapses to a single row.
  // Visible/total count and the archived link inherit their old position
  // from the deleted PresenceFilterRows.
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索智能体…"
          className="h-8 w-64 pl-8 text-sm"
        />
      </div>
      <div className="ml-auto flex items-center gap-3">
        {archivedCount > 0 && (
          <button
            type="button"
            onClick={onShowArchived}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            查看已归档（{archivedCount}）→
          </button>
        )}
        <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
          {visibleCount} / {totalCount}
        </span>
        <SortDropdown sort={sort} setSort={setSort} />
      </div>
    </div>
  );
}

function SortDropdown({
  sort,
  setSort,
}: {
  sort: SortKey;
  setSort: (v: SortKey) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          />
        }
      >
        <ArrowUpDown className="h-3 w-3" />
        {SORT_LABEL[sort]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto">
        {SORT_KEYS.map((k) => (
          <DropdownMenuItem
            key={k}
            onClick={() => setSort(k)}
            className="text-xs"
          >
            {SORT_LABEL[k]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Availability chip row — All / Online / Unstable / Offline. Only shown
// in the Active view; archived agents have no presence.
// ---------------------------------------------------------------------------

function AvailabilityFilterRow({
  value,
  onChange,
  counts,
  totalCount,
}: {
  value: AvailabilityFilter;
  onChange: (v: AvailabilityFilter) => void;
  counts: Record<AgentAvailability, number>;
  totalCount: number;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
      <AvailabilityChip
        active={value === "all"}
        onClick={() => onChange("all")}
        label="全部"
        count={totalCount}
      />
      {availabilityOrder.map((a) => {
        const cfg = availabilityConfig[a];
        return (
          <AvailabilityChip
            key={a}
            active={value === a}
            onClick={() => onChange(a)}
            label={cfg.label}
            count={counts[a]}
            dotClass={cfg.dotClass}
          />
        );
      })}
    </div>
  );
}

function AvailabilityChip({
  active,
  onClick,
  label,
  count,
  dotClass,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dotClass?: string;
}) {
  return (
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
      {dotClass && <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />}
      <span>{label}</span>
      <span className="font-mono tabular-nums text-muted-foreground/70">
        {count}
      </span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Archived view — single toolbar row (back link + title + count + sort).
// No presence chip row: presence is undefined for archived agents.
// ---------------------------------------------------------------------------

function ArchivedToolbarRow({
  onBack,
  archivedCount,
  sort,
  setSort,
}: {
  onBack: () => void;
  archivedCount: number;
  sort: SortKey;
  setSort: (v: SortKey) => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        活跃智能体
      </button>
      <span className="text-muted-foreground/40">/</span>
      <span className="text-xs font-medium">已归档智能体</span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
        {archivedCount}
      </span>
      <div className="ml-auto">
        <SortDropdown sort={sort} setSort={setSort} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / no-matches states
// ---------------------------------------------------------------------------

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Bot className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-semibold">还没有智能体</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        从能力池里选一条本地 CLI（Claude Code / Codex / Hermes），写下职责和工作上下文，新建一个智能体——之后想法池升级 Mission、多角色议事拍板、分叉探索都靠它出力。
      </p>
      <Button type="button" onClick={onCreate} size="sm" className="mt-5">
        <Plus className="h-3 w-3" />
        新建智能体
      </Button>
    </div>
  );
}

function NoMatches({
  view,
  search,
}: {
  view: View;
  search: string;
}) {
  const hasSearch = search.length > 0;

  let body: string;
  if (view === "archived") {
    body = hasSearch
      ? `没有匹配“${search}”的已归档智能体。`
      : "还没有已归档智能体。";
  } else if (hasSearch) {
    body = `没有匹配“${search}”的智能体。`;
  } else {
    body = "没有符合当前筛选条件的智能体。";
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center text-muted-foreground">
      <Search className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm">没有匹配项</p>
      <p className="max-w-xs text-xs">{body}</p>
    </div>
  );
}
