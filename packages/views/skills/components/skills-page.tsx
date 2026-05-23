"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Plus,
  Search,
} from "lucide-react";
import type {
  AgentRuntime,
  MemberWithUser,
  Skill,
} from "@multica/core/types";
import { useQuery } from "@tanstack/react-query";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  agentListOptions,
  memberListOptions,
  selectSkillAssignments,
  skillListOptions,
} from "@multica/core/workspace/queries";
import { runtimeListOptions } from "@multica/core/runtimes";
import { Button } from "@multica/ui/components/ui/button";
import { DataTable } from "@multica/ui/components/ui/data-table";
import { Input } from "@multica/ui/components/ui/input";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { useNavigation } from "../../navigation";
import { PageHeader } from "../../layout/page-header";
import { canEditSkill } from "../hooks/use-can-edit-skill";
import { readOrigin } from "../lib/origin";
import { CreateSkillDialog } from "./create-skill-dialog";
import { type SkillRow, createSkillColumns } from "./skill-columns";

type FilterKey = "all" | "used" | "unused" | "mine";

export const skillPageSubtitle = "工作区技能列表，可分配给智能体使用。";

export const skillPrimarySurface = {
  title: "技能",
  primaryCta: "新建技能",
  controls: ["搜索", "筛选"],
} as const;

export const skillListSecondaryActions = ["创建", "导入", "详情编辑", "删除确认"] as const;

export const skillDetailEntryLabel = "打开技能详情";

// ---------------------------------------------------------------------------
// Scope tab — matches Issues/MyIssues header pattern
// ---------------------------------------------------------------------------

const SCOPES: { value: FilterKey; label: string; description: string }[] = [
  { value: "all", label: "全部", description: "当前工作区里的全部技能" },
  { value: "used", label: "使用中", description: "已分配给至少一个智能体的技能" },
  { value: "unused", label: "未使用", description: "尚未分配给任何智能体的技能" },
  { value: "mine", label: "我创建的", description: "由你创建的技能" },
];

// ---------------------------------------------------------------------------
// Page header bar — uses shared PageHeader so the mobile sidebar trigger and
// h-12 chrome stay consistent with every other dashboard list page.
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
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">技能</h1>
        {totalCount > 0 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
            {totalCount}
          </span>
        )}
        <p className="ml-2 hidden text-xs text-muted-foreground md:block">
          {skillPageSubtitle}
        </p>
      </div>
      <Button type="button" size="sm" onClick={onCreate}>
        <Plus className="h-3 w-3" />
        新建技能
      </Button>
    </PageHeader>
  );
}

// ---------------------------------------------------------------------------
// Card toolbar — search + scope filters, kept inside the card because they
// operate on the table content. Page-level actions (New skill) live in the
// PageHeader instead.
// ---------------------------------------------------------------------------

function CardToolbar({
  search,
  setSearch,
  filter,
  setFilter,
}: {
  search: string;
  setSearch: (v: string) => void;
  filter: FilterKey;
  setFilter: (v: FilterKey) => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索技能…"
          className="h-8 w-64 pl-8 text-sm"
        />
      </div>
      {SCOPES.map((s) => (
        <Tooltip key={s.value}>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className={
                  filter === s.value
                    ? "bg-accent text-accent-foreground hover:bg-accent/80"
                    : "text-muted-foreground"
                }
                onClick={() => setFilter(s.value)}
              >
                {s.label}
              </Button>
            }
          />
          <TooltipContent side="bottom">{s.description}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <BookOpen className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-semibold">暂无技能</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        创建第一个技能、从 URL 导入，或从已连接的运行环境复制一个技能。工作区里的所有智能体都能使用它。
      </p>
      <Button type="button" onClick={onCreate} size="sm" className="mt-5">
        <Plus className="h-3 w-3" />
        新建技能
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SkillsPage() {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const {
    data: skills = [],
    isLoading,
    error: listError,
    refetch: refetchList,
  } = useQuery(skillListOptions(wsId));
  const { data: agents = [], error: agentsError } = useQuery(
    agentListOptions(wsId),
  );
  const { data: members = [], error: membersError } = useQuery(
    memberListOptions(wsId),
  );
  const { data: runtimes = [], error: runtimesError } = useQuery(
    runtimeListOptions(wsId),
  );

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [createOpen, setCreateOpen] = useState(false);

  // Derive assignments ONCE per agents-identity. Stable reference across
  // unrelated agent refetches — see selectSkillAssignments' doc.
  const assignments = useMemo(
    () => selectSkillAssignments(agents),
    [agents],
  );

  const membersById = useMemo(() => {
    const map = new Map<string, MemberWithUser>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const runtimesById = useMemo(() => {
    const map = new Map<string, AgentRuntime>();
    for (const r of runtimes) map.set(r.id, r);
    return map;
  }, [runtimes]);

  const myRole =
    members.find((m) => m.user_id === currentUserId)?.role ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byAssignment = (s: Skill) =>
      (assignments.get(s.id)?.length ?? 0) > 0;

    return skills.filter((s) => {
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.description.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (filter === "used" && !byAssignment(s)) return false;
      if (filter === "unused" && byAssignment(s)) return false;
      if (filter === "mine" && s.created_by !== currentUserId) return false;
      return true;
    });
  }, [skills, assignments, search, filter, currentUserId]);

  const handleCreated = (skill: Skill) => {
    navigation.push(paths.skillDetail(skill.id));
  };

  // Assemble per-row data once per render — skill + agents + creator +
  // origin-runtime + permission flag. The table's column cells read off
  // `row.original` and never pull their own queries.
  const skillRows = useMemo<SkillRow[]>(() => {
    return filtered.map((skill) => {
      const origin = readOrigin(skill);
      const runtime =
        origin.type === "runtime_local" && origin.runtime_id
          ? runtimesById.get(origin.runtime_id) ?? null
          : null;
      return {
        skill,
        agents: assignments.get(skill.id) ?? [],
        creator: skill.created_by
          ? membersById.get(skill.created_by) ?? null
          : null,
        runtime,
        canEdit: canEditSkill(skill, {
          userId: currentUserId,
          role: myRole,
        }),
      };
    });
  }, [
    filtered,
    assignments,
    membersById,
    runtimesById,
    currentUserId,
    myRole,
  ]);

  const columns = useMemo(() => createSkillColumns(), []);

  const table = useReactTable({
    data: skillRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
  });

  // --- Loading ---
  if (isLoading) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <PageHeaderBar totalCount={0} onCreate={() => setCreateOpen(true)} />
        <div className="flex flex-1 min-h-0 flex-col gap-4 p-6">
          <div className="space-y-3 pl-4">
            <Skeleton className="h-5 w-full max-w-2xl rounded-md" />
            <Skeleton className="h-14 w-full max-w-3xl rounded-md" />
          </div>
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
              <Skeleton className="h-8 w-64 rounded-md" />
              <Skeleton className="h-7 w-12 rounded-md" />
              <Skeleton className="h-7 w-14 rounded-md" />
              <Skeleton className="h-7 w-16 rounded-md" />
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

  // --- List request error ---
  if (listError) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <PageHeaderBar totalCount={0} onCreate={() => setCreateOpen(true)} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <div>
            <p className="text-sm font-medium">无法加载技能</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {listError instanceof Error
                ? listError.message
                : "获取技能列表时出错。"}
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

  const totalCount = skills.length;
  const showEmpty = totalCount === 0;
  const supportingQueryDown =
    !!agentsError || !!membersError || !!runtimesError;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeaderBar
        totalCount={totalCount}
        onCreate={() => setCreateOpen(true)}
      />

      {/* Non-blocking banner when supporting queries fail — list still renders
          but creator/runtime/permission attribution is incomplete. */}
      {supportingQueryDown && (
        <div
          role="status"
          className="flex shrink-0 items-start gap-2 border-b bg-warning/10 px-6 py-2 text-xs text-muted-foreground"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            部分工作区数据加载失败。创建者、运行环境名称或编辑权限信息可能暂时不完整。
          </span>
        </div>
      )}

      {/* Page body — padding here keeps the card from touching the chrome,
          and `gap-4` separates the intro banner from the table card. */}
      <div className="flex flex-1 min-h-0 flex-col gap-4 p-6">
        {showEmpty ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState onCreate={() => setCreateOpen(true)} />
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
            <CardToolbar
              search={search}
              setSearch={setSearch}
              filter={filter}
              setFilter={setFilter}
            />
            {filtered.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center text-muted-foreground">
                <Search className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm">没有匹配项</p>
                <p className="max-w-xs text-xs">
                  {search
                    ? `没有匹配“${search}”的技能${filter !== "all" ? "（当前筛选范围内）" : ""}。`
                    : "当前筛选条件下没有技能。"}{" "}
                  换个关键词试试。
                </p>
              </div>
            ) : (
              <DataTable
                table={table}
                onRowClick={(row) =>
                  navigation.push(paths.skillDetail(row.original.skill.id))
                }
              />
            )}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateSkillDialog
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
