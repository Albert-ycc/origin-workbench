"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ChevronRight,
  GitBranch,
  Loader2,
  Plus,
  Route,
  Sparkles,
  Trash2,
  Trophy,
  XCircle,
} from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
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
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { PageHeader } from "../layout/page-header";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";
import { AppLink } from "../navigation";

// PRD §14.7 — seven required fields. The order here drives the row order in
// the compare panel; keep it stable so users build muscle memory.
const BRANCH_FIELDS: Array<{
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
  const p = useWorkspacePaths();

  const listQuery = useQuery(explorationListOptions(wsId));
  const explorations = listQuery.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => explorations.find((e) => e.id === selectedId) ?? explorations[0] ?? null,
    [explorations, selectedId],
  );

  const detailQuery = useQuery({
    ...explorationDetailOptions(wsId, selected?.id ?? ""),
    enabled: !!selected,
  });

  const [createOpen, setCreateOpen] = useState(false);

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
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              missionsHref={p.missions()}
            />
          </aside>

          <section>
            <ExplorationDetail
              exploration={selected}
              branches={detailQuery.data?.branches ?? []}
              loading={detailQuery.isLoading}
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
  missionsHref,
}: {
  explorations: Exploration[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  missionsHref: string;
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
          还没有探索。把一个未定方向的问题拆成几条分支，让团队各自试一下。
          <AppLink href={missionsHref} className="ml-1 text-primary hover:underline">
            从 Mission 切入
          </AppLink>
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
}: {
  exploration: Exploration | null;
  branches: ExplorationBranch[];
  loading: boolean;
}) {
  const archive = useArchiveExploration();
  const remove = useDeleteExploration();
  const [addBranchOpen, setAddBranchOpen] = useState(false);

  if (!exploration) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        左侧选一个探索，这里看 7 字段对比表、加分支、标选中。
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
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await archive.mutateAsync(exploration.id);
                toast.success("已归档");
              } catch (err) {
                toast.error("归档失败", { description: err instanceof Error ? err.message : String(err) });
              }
            }}
          >
            <Archive className="size-3.5" />
            归档
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={async () => {
              if (!window.confirm(`删除探索「${exploration.topic}」？此操作不可撤销。`)) return;
              try {
                await remove.mutateAsync(exploration.id);
                toast.success("已删除");
              } catch (err) {
                toast.error("删除失败", { description: err instanceof Error ? err.message : String(err) });
              }
            }}
          >
            <Trash2 className="size-3.5" />
            删除
          </Button>
        </div>
      </div>

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
  const update = useUpdateExploration();
  const [decision, setDecision] = useState(exploration.decision);
  useEffect(() => setDecision(exploration.decision), [exploration.id, exploration.decision]);

  const winning = branches.find((b) => b.verdict === "winning");

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

      <div className="mt-4 grid gap-2 md:grid-cols-[120px_1fr_auto]">
        <Label htmlFor="exploration-decision" className="self-center text-xs">
          决议笔记
        </Label>
        <Textarea
          id="exploration-decision"
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          placeholder="收敛后写下最终决议、为什么选这个、放弃的方案是因为什么"
          rows={2}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={decision === exploration.decision || update.isPending}
          onClick={async () => {
            try {
              await update.mutateAsync({ id: exploration.id, decision });
              toast.success("决议已保存");
            } catch (err) {
              toast.error("保存失败", { description: err instanceof Error ? err.message : String(err) });
            }
          }}
        >
          {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "保存"}
        </Button>
      </div>
    </header>
  );
}

function CompareTable({
  explorationId,
  branches,
}: {
  explorationId: string;
  branches: ExplorationBranch[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[640px] table-fixed border-collapse">
        <thead>
          <tr className="border-b">
            <th className="w-28 bg-muted/40 p-3 text-left align-top text-xs font-semibold text-muted-foreground">
              字段
            </th>
            {branches.map((b) => (
              <th
                key={b.id}
                className="min-w-[220px] border-l p-3 align-top text-left"
              >
                <BranchHeader explorationId={explorationId} branch={b} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BRANCH_FIELDS.map((field) => (
            <tr key={field.key} className="border-b last:border-0">
              <td className="bg-muted/40 p-3 align-top text-xs font-medium text-muted-foreground">
                {field.label}
              </td>
              {branches.map((b) => (
                <td key={b.id} className="border-l p-2 align-top">
                  <BranchFieldEditor
                    explorationId={explorationId}
                    branch={b}
                    fieldKey={field.key}
                    placeholder={field.placeholder}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BranchHeader({ explorationId, branch }: { explorationId: string; branch: ExplorationBranch }) {
  const update = useUpdateExplorationBranch();
  const remove = useDeleteExplorationBranch();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{branch.title}</span>
        <Badge className={cn("shrink-0 text-[10px]", VERDICT_TONE[branch.verdict])}>
          {VERDICT_LABEL[branch.verdict]}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(["winning", "runner_up", "discarded", "pending"] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={branch.verdict === v ? "default" : "outline"}
            className="h-6 px-2 text-[11px]"
            onClick={async () => {
              try {
                await update.mutateAsync({
                  explorationId,
                  branchId: branch.id,
                  verdict: v,
                });
              } catch (err) {
                toast.error("标记失败", { description: err instanceof Error ? err.message : String(err) });
              }
            }}
          >
            {VERDICT_LABEL[v]}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-1.5 text-destructive hover:text-destructive"
          onClick={async () => {
            if (!window.confirm(`删除分支「${branch.title}」？`)) return;
            try {
              await remove.mutateAsync({ explorationId, branchId: branch.id });
              toast.success("分支已删除");
            } catch (err) {
              toast.error("删除失败", { description: err instanceof Error ? err.message : String(err) });
            }
          }}
        >
          <XCircle className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function BranchFieldEditor({
  explorationId,
  branch,
  fieldKey,
  placeholder,
}: {
  explorationId: string;
  branch: ExplorationBranch;
  fieldKey:
    | "core_proposal"
    | "design_logic"
    | "key_decisions"
    | "cost_estimate"
    | "risk_points"
    | "fits"
    | "does_not_fit";
  placeholder: string;
}) {
  const update = useUpdateExplorationBranch();
  const serverValue = branch[fieldKey];
  const [value, setValue] = useState(serverValue);
  // Track which server snapshot we last synced from. Server values arriving
  // while the user is mid-edit (TanStack Query refetch, WS invalidation, our
  // own mutation success) must NOT clobber the textarea — only adopt them
  // when we genuinely have no pending local changes against that snapshot.
  const lastSyncedRef = useRef(serverValue);

  useEffect(() => {
    if (lastSyncedRef.current === value) {
      // Local matches what we last synced — safe to adopt server value.
      setValue(serverValue);
      lastSyncedRef.current = serverValue;
    } else {
      // Local has unsaved edits; just record what server now holds so a
      // later flush sends the right value, but don't overwrite the user.
      lastSyncedRef.current = serverValue;
    }
    // Intentionally only react to serverValue. branch.id changes also flow
    // through serverValue (different branch → different field text), so we
    // don't need it as a separate dependency.
  }, [serverValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = value !== serverValue;

  const flush = async () => {
    if (!dirty) return;
    try {
      await update.mutateAsync({
        explorationId,
        branchId: branch.id,
        [fieldKey]: value,
      } as Parameters<typeof update.mutateAsync>[0]);
      lastSyncedRef.current = value;
    } catch (err) {
      toast.error("保存失败", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={flush}
      placeholder={placeholder}
      rows={3}
      className={cn(
        "min-h-20 resize-y border-transparent bg-transparent text-xs hover:border-input focus:border-input",
        dirty && "border-amber-400/60",
      )}
    />
  );
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
