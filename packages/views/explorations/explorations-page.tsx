"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ChevronRight,
  GitBranch,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Route,
  Sparkles,
  Trash2,
  Trophy,
} from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace } from "@multica/core/paths";
import {
  explorationDetailOptions,
  explorationListOptions,
  useArchiveExploration,
  useCreateExploration,
  useCreateExplorationBranch,
  useDeleteExploration,
  useDeleteExplorationBranch,
  useUpdateExploration,
  useUpdateExplorationBranch,
} from "@multica/core/explorations";
import type {
  Exploration,
  ExplorationBranch,
  ExplorationBranchVerdict,
  ExplorationStatus,
} from "@multica/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@multica/ui/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@multica/ui/components/ui/sheet";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { PageHeader } from "../layout/page-header";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";

// PRD §14.7 — seven required fields. The order here drives the row order in
// the compare panel; keep it stable so users build muscle memory.
export const branchEditFields: Array<{
  key: keyof Pick<
    ExplorationBranch,
    | "core_proposal"
    | "design_logic"
    | "key_decisions"
    | "cost_estimate"
    | "risk_points"
    | "fits"
    | "does_not_fit"
  >;
  label: string;
  placeholder: string;
}> = [
  { key: "core_proposal", label: "方案核心", placeholder: "一句话说清这个方案是什么" },
  { key: "design_logic", label: "设计逻辑", placeholder: "为什么这样设计、解决什么问题" },
  { key: "key_decisions", label: "关键决策", placeholder: "哪些权衡选择影响最大" },
  { key: "cost_estimate", label: "成本估算", placeholder: "工时 / 资源 / 复杂度" },
  { key: "risk_points", label: "风险点", placeholder: "可能踩什么坑、怎么兜底" },
  { key: "fits", label: "适用条件", placeholder: "在什么场景下成立" },
  { key: "does_not_fit", label: "不适用条件", placeholder: "在什么场景下要换方案" },
];

export const explorationHomeSections = [
  { title: "探索列表" },
  { title: "当前探索对比表" },
] as const;

export const explorationPrimarySurfaces = ["探索列表", "7 字段横向对比"] as const;

export const explorationDangerConfirmations = {
  explorationDelete: "alert-dialog",
  branchDelete: "alert-dialog",
} as const;

export function shouldLoadExplorationDetail(selectedId: string | null) {
  return !!selectedId;
}

export function closeExplorationAfterMutation({
  setSelectedId,
}: {
  setSelectedId: (id: string | null) => void;
}) {
  setSelectedId(null);
}

const STATUS_LABEL: Record<ExplorationStatus, string> = {
  open: "探索中",
  converging: "收敛中",
  closed: "已结案",
  archived: "已归档",
};

const VERDICT_LABEL: Record<ExplorationBranchVerdict, string> = {
  pending: "待评",
  winning: "选中",
  runner_up: "次选",
  discarded: "弃用",
};

const VERDICT_TONE: Record<ExplorationBranchVerdict, string> = {
  pending: "bg-muted text-muted-foreground",
  winning: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  runner_up: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  discarded: "bg-destructive/10 text-destructive",
};

export function ExplorationsPage() {
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();

  const listQuery = useQuery(explorationListOptions(wsId));
  const explorations = listQuery.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => explorations.find((e) => e.id === selectedId) ?? null,
    [explorations, selectedId],
  );

  const detailQuery = useQuery({
    ...explorationDetailOptions(wsId, selectedId ?? ""),
    enabled: shouldLoadExplorationDetail(selectedId),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const clearSelection = () => closeExplorationAfterMutation({ setSelectedId });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <PageHeader className="gap-1.5">
        <WorkspaceAvatar name={workspace?.name ?? "O"} size="sm" />
        <span className="text-sm text-muted-foreground">Origin</span>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="text-sm font-medium">分叉探索</span>
      </PageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-3">
            <Button onClick={() => setCreateOpen(true)} size="sm">
              <Plus className="size-3.5" />
              新建探索
            </Button>
            <CreateExplorationDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setSelectedId} />
            <ExplorationsList
              explorations={explorations}
              loading={listQuery.isLoading}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </aside>

          <section>
            <ExplorationDetail
              exploration={selected}
              branches={detailQuery.data?.branches ?? []}
              loading={detailQuery.isLoading}
              onClearSelection={clearSelection}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// List
// ────────────────────────────────────────────────────────────────────────

function ExplorationsList({
  explorations,
  loading,
  selectedId,
  onSelect,
}: {
  explorations: Exploration[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (explorations.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-5 text-center">
        <Sparkles className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-3 text-xs text-muted-foreground">
          还没有探索。先创建一个探索，再添加 2-4 条分支，把同一个问题放进 7 字段表里横向比较。
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {explorations.map((exp) => (
        <li
          key={exp.id}
          className={cn(
            "cursor-pointer p-3 transition-colors hover:bg-muted/40",
            selectedId === exp.id && "bg-muted/60",
          )}
          onClick={() => onSelect(exp.id)}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="flex-1 truncate text-sm font-medium">{exp.topic}</span>
            <Badge variant="outline" className="text-[10px]">
              {STATUS_LABEL[exp.status]}
            </Badge>
          </div>
          {exp.question ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{exp.question}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Detail + compare panel
// ────────────────────────────────────────────────────────────────────────

function ExplorationDetail({
  exploration,
  branches,
  loading,
  onClearSelection,
}: {
  exploration: Exploration | null;
  branches: ExplorationBranch[];
  loading: boolean;
  onClearSelection: () => void;
}) {
  const archive = useArchiveExploration();
  const remove = useDeleteExploration();
  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!exploration) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        左侧选择一个探索查看 7 字段横向对比表；也可以先新建探索，再添加 2-4 条分支。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ExplorationHeader exploration={exploration} branches={branches} />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <GitBranch className="size-4" />
          分支对比 ({branches.length})
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAddBranchOpen(true)}>
            <Plus className="size-3.5" />
            加分支
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
              <MoreHorizontal className="size-3.5" />
              更多
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await archive.mutateAsync(exploration.id);
                    toast.success("已归档");
                    onClearSelection();
                  } catch (err) {
                    toast.error("归档失败", { description: err instanceof Error ? err.message : String(err) });
                  }
                }}
              >
                <Archive className="size-3.5" />
                归档
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除探索</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{exploration.topic}」后无法撤销，所有分支对比内容也会一并移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                try {
                  await remove.mutateAsync(exploration.id);
                  toast.success("已删除");
                  setDeleteOpen(false);
                  onClearSelection();
                } catch (err) {
                  toast.error("删除失败", { description: err instanceof Error ? err.message : String(err) });
                }
              }}
            >
              {remove.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateBranchDialog
        explorationId={exploration.id}
        open={addBranchOpen}
        onOpenChange={setAddBranchOpen}
      />

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : branches.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          还没有分支。每个分支需要填齐 7 个字段（方案核心 / 设计逻辑 / 关键决策 / 成本估算 / 风险点 / 适用 / 不适用），
          <br />
          这样收敛时才能把所有方案放在同一张表里直接对比。
        </div>
      ) : (
        <CompareTable explorationId={exploration.id} branches={branches} />
      )}
    </div>
  );
}

function ExplorationHeader({
  exploration,
  branches,
}: {
  exploration: Exploration;
  branches: ExplorationBranch[];
}) {
  const winning = branches.find((b) => b.verdict === "winning");
  const [decisionOpen, setDecisionOpen] = useState(false);

  return (
    <header className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Route className="size-4 text-primary" />
            <h1 className="truncate text-base font-semibold">{exploration.topic}</h1>
            <Badge variant="outline">{STATUS_LABEL[exploration.status]}</Badge>
          </div>
          {exploration.question ? (
            <p className="mt-2 text-sm text-muted-foreground">{exploration.question}</p>
          ) : null}
        </div>
        {winning ? (
          <Badge className="shrink-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            <Trophy className="size-3" />
            选中：{winning.title}
          </Badge>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border bg-background p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-muted-foreground">决议摘要</div>
          <Button size="sm" variant="ghost" onClick={() => setDecisionOpen(true)}>
            <Pencil className="size-3.5" />
            编辑
          </Button>
        </div>
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
          {exploration.decision || "还没有决议。完成分支对比后再写下最终选择和原因。"}
        </p>
      </div>

      <DecisionDialog exploration={exploration} open={decisionOpen} onOpenChange={setDecisionOpen} />
    </header>
  );
}

function DecisionDialog({
  exploration,
  open,
  onOpenChange,
}: {
  exploration: Exploration;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateExploration();
  const [decision, setDecision] = useState(exploration.decision);

  useEffect(() => {
    if (open) setDecision(exploration.decision);
  }, [exploration.id, exploration.decision, open]);

  const submitting = update.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑决议笔记</DialogTitle>
          <DialogDescription>记录最终决议、为什么选这个、放弃的方案是因为什么。</DialogDescription>
        </DialogHeader>
        <Textarea
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          placeholder="收敛后写下最终决议、判断依据和后续动作"
          rows={6}
          disabled={submitting}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            disabled={decision === exploration.decision || submitting}
            onClick={async () => {
              try {
                await update.mutateAsync({ id: exploration.id, decision });
                toast.success("决议已保存");
                onOpenChange(false);
              } catch (err) {
                toast.error("保存失败", { description: err instanceof Error ? err.message : String(err) });
              }
            }}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompareTable({
  explorationId,
  branches,
}: {
  explorationId: string;
  branches: ExplorationBranch[];
}) {
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const editingBranch = branches.find((branch) => branch.id === editingBranchId) ?? null;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[640px] table-fixed border-collapse">
          <thead>
            <tr className="border-b">
              <th className="w-28 bg-muted/40 p-3 text-left align-top text-xs font-semibold text-muted-foreground">
                字段
              </th>
              {branches.map((branch) => (
                <th
                  key={branch.id}
                  className="min-w-[220px] border-l p-3 align-top text-left"
                >
                  <BranchHeader branch={branch} onEdit={() => setEditingBranchId(branch.id)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {branchEditFields.map((field) => (
              <tr key={field.key} className="border-b last:border-0">
                <td className="bg-muted/40 p-3 align-top text-xs font-medium text-muted-foreground">
                  {field.label}
                </td>
                {branches.map((branch) => (
                  <td key={branch.id} className="border-l p-2 align-top">
                    <button
                      type="button"
                      className="min-h-16 w-full rounded-md p-2 text-left text-xs transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
                      onClick={() => setEditingBranchId(branch.id)}
                    >
                      {branch[field.key].trim() ? (
                        <span className="line-clamp-3 whitespace-pre-wrap">{branch[field.key]}</span>
                      ) : (
                        <span className="text-muted-foreground">点击补充{field.label}</span>
                      )}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BranchEditSheet
        explorationId={explorationId}
        branch={editingBranch}
        open={!!editingBranch}
        onOpenChange={(open) => {
          if (!open) setEditingBranchId(null);
        }}
      />
    </>
  );
}

function BranchHeader({ branch, onEdit }: { branch: ExplorationBranch; onEdit: () => void }) {
  return (
    <button type="button" className="w-full space-y-2 text-left" onClick={onEdit}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{branch.title}</span>
        <Badge className={cn("shrink-0 text-[10px]", VERDICT_TONE[branch.verdict])}>
          {VERDICT_LABEL[branch.verdict]}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground">点击编辑 7 字段和判定</div>
    </button>
  );
}

function BranchEditSheet({
  explorationId,
  branch,
  open,
  onOpenChange,
}: {
  explorationId: string;
  branch: ExplorationBranch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateExplorationBranch();
  const remove = useDeleteExplorationBranch();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState(() => branchDraft(branch));

  useEffect(() => {
    setDraft(branchDraft(branch));
  }, [branch?.id]);

  if (!branch) {
    return <Sheet open={open} onOpenChange={onOpenChange} />;
  }

  const dirty =
    draft.title !== branch.title ||
    draft.verdict !== branch.verdict ||
    branchEditFields.some((field) => draft[field.key] !== branch[field.key]);
  const submitting = update.isPending || remove.isPending;

  const save = async () => {
    if (!dirty) return;
    try {
      await update.mutateAsync({
        explorationId,
        branchId: branch.id,
        title: draft.title.trim() || branch.title,
        verdict: draft.verdict,
        ...Object.fromEntries(branchEditFields.map((field) => [field.key, draft[field.key]])),
      } as Parameters<typeof update.mutateAsync>[0]);
      toast.success("分支已保存");
      onOpenChange(false);
    } catch (err) {
      toast.error("保存失败", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[min(640px,96vw)] gap-0 p-0 sm:max-w-none">
          <SheetHeader className="border-b px-5 py-4 pr-12">
            <SheetTitle>编辑分支</SheetTitle>
            <SheetDescription>完整编辑 7 字段，对比表保持阅读视图。</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div className="space-y-1.5">
              <Label htmlFor="branch-edit-title" className="text-xs">
                分支名
              </Label>
              <Input
                id="branch-edit-title"
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branch-edit-verdict" className="text-xs">
                分支判定
              </Label>
              <NativeSelect
                id="branch-edit-verdict"
                value={draft.verdict}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    verdict: e.target.value as ExplorationBranchVerdict,
                  }))
                }
                disabled={submitting}
              >
                {(["pending", "winning", "runner_up", "discarded"] as const).map((verdict) => (
                  <NativeSelectOption key={verdict} value={verdict}>
                    {VERDICT_LABEL[verdict]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-3">
              {branchEditFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`branch-edit-${field.key}`} className="text-xs">
                    {field.label}
                  </Label>
                  <Textarea
                    id={`branch-edit-${field.key}`}
                    value={draft[field.key]}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    placeholder={field.placeholder}
                    rows={3}
                    disabled={submitting}
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 border-t pt-4">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
                  <MoreHorizontal className="size-3.5" />
                  更多
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-3.5" />
                    删除分支
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                  取消
                </Button>
                <Button size="sm" onClick={save} disabled={!dirty || submitting}>
                  {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  保存
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分支</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{branch.title}」后无法撤销，这条分支的 7 字段内容也会被移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                try {
                  await remove.mutateAsync({ explorationId, branchId: branch.id });
                  toast.success("分支已删除");
                  setDeleteOpen(false);
                  onOpenChange(false);
                } catch (err) {
                  toast.error("删除失败", { description: err instanceof Error ? err.message : String(err) });
                }
              }}
            >
              {remove.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function branchDraft(branch: ExplorationBranch | null) {
  return {
    title: branch?.title ?? "",
    verdict: branch?.verdict ?? "pending",
    core_proposal: branch?.core_proposal ?? "",
    design_logic: branch?.design_logic ?? "",
    key_decisions: branch?.key_decisions ?? "",
    cost_estimate: branch?.cost_estimate ?? "",
    risk_points: branch?.risk_points ?? "",
    fits: branch?.fits ?? "",
    does_not_fit: branch?.does_not_fit ?? "",
  } satisfies Pick<ExplorationBranch, "title" | "verdict"> &
    Pick<
      ExplorationBranch,
      | "core_proposal"
      | "design_logic"
      | "key_decisions"
      | "cost_estimate"
      | "risk_points"
      | "fits"
      | "does_not_fit"
    >;
}

// ────────────────────────────────────────────────────────────────────────
// Dialogs
// ────────────────────────────────────────────────────────────────────────

function CreateExplorationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const create = useCreateExploration();
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState("");

  useEffect(() => {
    if (!open) {
      setTopic("");
      setQuestion("");
    }
  }, [open]);

  const submitting = create.isPending;
  const canSubmit = !submitting && topic.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建分叉探索</DialogTitle>
          <DialogDescription>
            写下要探索的主题和核心问题，下一步给它加 2 ~ 4 条分支并填齐 7 字段。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="exp-topic" className="text-xs">主题</Label>
            <Input
              id="exp-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="比如：营养库 schema 单表 vs 分表"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-question" className="text-xs">核心问题（可选）</Label>
            <Textarea
              id="exp-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="想要回答的具体问题，例如「哪个方案更适合长期演化」"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={async () => {
              try {
                const detail = await create.mutateAsync({
                  topic: topic.trim(),
                  question: question.trim() || undefined,
                });
                toast.success("探索已建");
                onCreated(detail.exploration.id);
                onOpenChange(false);
              } catch (err) {
                toast.error("创建失败", { description: err instanceof Error ? err.message : String(err) });
              }
            }}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Route className="size-3.5" />}
            建探索
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateBranchDialog({
  explorationId,
  open,
  onOpenChange,
}: {
  explorationId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useCreateExplorationBranch();
  const [title, setTitle] = useState("");
  const [coreProposal, setCoreProposal] = useState("");

  useEffect(() => {
    if (!open) {
      setTitle("");
      setCoreProposal("");
    }
  }, [open]);

  const submitting = create.isPending;
  const canSubmit = !submitting && title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>加一条分支</DialogTitle>
          <DialogDescription>
            先给分支起名 + 一句话方案核心，剩下 6 个字段在对比表里直接填，blur 自动保存。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="branch-title" className="text-xs">分支名</Label>
            <Input
              id="branch-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="比如：分支 A · 单表"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch-core" className="text-xs">方案核心（可选）</Label>
            <Textarea
              id="branch-core"
              value={coreProposal}
              onChange={(e) => setCoreProposal(e.target.value)}
              placeholder="一句话说清这个方案是什么"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={async () => {
              try {
                await create.mutateAsync({
                  explorationId,
                  title: title.trim(),
                  core_proposal: coreProposal.trim() || undefined,
                });
                toast.success("分支已建，去填剩下的字段");
                onOpenChange(false);
              } catch (err) {
                toast.error("创建失败", { description: err instanceof Error ? err.message : String(err) });
              }
            }}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
            加分支
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
