"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ChevronRight,
  Lightbulb,
  Loader2,
  Network,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import {
  ideaDetailOptions,
  ideaListOptions,
  useArchiveIdea,
  useCreateIdea,
  useCreateIdeaNote,
  useDeleteIdea,
  usePromoteIdea,
} from "@multica/core/ideas";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { Agent, Idea, IdeaNurtureNote } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@multica/ui/components/ui/native-select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { PageHeader } from "../layout/page-header";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";
import { AppLink, useNavigation } from "../navigation";

export function IdeasPage() {
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();

  const ideasQuery = useQuery(ideaListOptions(wsId, "active"));
  const ideas = ideasQuery.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdea = useMemo(
    () => ideas.find((i) => i.id === selectedId) ?? ideas[0] ?? null,
    [ideas, selectedId],
  );

  const detailQuery = useQuery({
    ...ideaDetailOptions(wsId, selectedIdea?.id ?? ""),
    enabled: !!selectedIdea,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <PageHeader className="gap-1.5">
        <WorkspaceAvatar name={workspace?.name ?? "O"} size="sm" />
        <span className="text-sm text-muted-foreground">Origin</span>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="text-sm font-medium">想法池</span>
      </PageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="flex flex-col gap-4">
            <ComposeIdea />
            <IdeasList
              ideas={ideas}
              loading={ideasQuery.isLoading}
              selectedId={selectedIdea?.id ?? null}
              onSelect={setSelectedId}
              missionsHref={p.missions()}
            />
          </section>

          <aside className="space-y-4">
            <IdeaDetailPanel
              idea={selectedIdea}
              notes={detailQuery.data?.notes ?? []}
              loading={detailQuery.isLoading}
            />
            <PhaseHint />
          </aside>
        </div>
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Compose: capture an idea
// ────────────────────────────────────────────────────────────────────────

function ComposeIdea() {
  const [text, setText] = useState("");
  const createIdea = useCreateIdea();
  const submitting = createIdea.isPending;

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await createIdea.mutateAsync({ description: trimmed, source: "manual" });
      setText("");
      toast.success("想法已入池");
    } catch (err) {
      toast.error("记录失败", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Lightbulb className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold">想法池</h1>
            <p className="text-sm text-muted-foreground">先收拢未成型的想法，养成熟了再升级 Mission。</p>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="冒出来一个想法？先记下来——首句会自动作为标题，描述可以随意展开。"
          rows={3}
          disabled={submitting}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">⌘ + Enter 发送</span>
          <Button size="sm" onClick={submit} disabled={!text.trim() || submitting}>
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            丢进鱼池
          </Button>
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// List
// ────────────────────────────────────────────────────────────────────────

function IdeasList({
  ideas,
  loading,
  selectedId,
  onSelect,
  missionsHref,
}: {
  ideas: Idea[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  missionsHref: string;
}) {
  if (loading) {
    return (
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </section>
    );
  }
  if (ideas.length === 0) {
    return (
      <section className="rounded-lg border bg-card p-8 text-center">
        <Sparkles className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          还没有想法。先在上面写一个——养好了可以一键转 Mission，去
          <AppLink href={missionsHref} className="ml-1 text-primary hover:underline">
            任务中枢
          </AppLink>
          看后续进展。
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-sm font-semibold">待孵化想法</h2>
        <Badge variant="outline">{ideas.length}</Badge>
      </div>
      <ul className="divide-y">
        {ideas.map((idea) => (
          <li
            key={idea.id}
            className={cn(
              "cursor-pointer p-4 transition-colors hover:bg-muted/40",
              selectedId === idea.id && "bg-muted/60",
            )}
            onClick={() => onSelect(idea.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{idea.title}</div>
                {idea.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{idea.description}</p>
                ) : null}
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">
                    {idea.status === "nurturing" ? "养护中" : idea.status}
                  </Badge>
                  {idea.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      #{t}
                    </Badge>
                  ))}
                  <span className="ml-auto">{formatRelativeTime(idea.last_nurtured_at ?? idea.created_at)}</span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Detail panel
// ────────────────────────────────────────────────────────────────────────

function IdeaDetailPanel({
  idea,
  notes,
  loading,
}: {
  idea: Idea | null;
  notes: IdeaNurtureNote[];
  loading: boolean;
}) {
  const archiveIdea = useArchiveIdea();
  const deleteIdea = useDeleteIdea();
  const createNote = useCreateIdeaNote();
  const [noteText, setNoteText] = useState("");
  const [promoteOpen, setPromoteOpen] = useState(false);

  if (!idea) {
    return (
      <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        左侧选一个想法，这里看详情、加养护笔记、转 Mission 或归档。
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <div className="text-sm font-semibold">{idea.title}</div>
        {idea.description ? (
          <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{idea.description}</p>
        ) : null}
      </div>

      <PromoteIdeaDialog
        idea={idea}
        notes={notes}
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
      />

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => setPromoteOpen(true)}>
          <Network className="size-3.5" />
          升级 Mission
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await archiveIdea.mutateAsync(idea.id);
              toast.success("已归档");
            } catch (err) {
              toast.error("归档失败", { description: err instanceof Error ? err.message : String(err) });
            }
          }}
        >
          <Archive className="size-3.5" />
          归档
        </Button>
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={async () => {
          if (!window.confirm(`删除「${idea.title}」？此操作不可撤销。`)) return;
          try {
            await deleteIdea.mutateAsync(idea.id);
            toast.success("已删除");
          } catch (err) {
            toast.error("删除失败", { description: err instanceof Error ? err.message : String(err) });
          }
        }}
      >
        <Trash2 className="size-3.5" />
        删除
      </Button>

      <div className="border-t pt-3">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">养护笔记 ({notes.length})</div>
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有笔记。手动加一条看看角色思考的痕迹会怎么沉淀。</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border bg-background p-2 text-xs">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px]">
                    {labelForNoteKind(n.kind)}
                  </Badge>
                  <span className="text-muted-foreground">{formatRelativeTime(n.created_at)}</span>
                </div>
                <p className="mt-1 text-foreground">{n.summary}</p>
                {n.body ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{n.body}</p> : null}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 space-y-2">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="加一条养护笔记（角度、相关历史、参考、问题…）"
            rows={2}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!noteText.trim() || createNote.isPending}
            onClick={async () => {
              try {
                await createNote.mutateAsync({ ideaId: idea.id, summary: noteText.trim(), kind: "new_angle" });
                setNoteText("");
                toast.success("笔记已加");
              } catch (err) {
                toast.error("加笔记失败", { description: err instanceof Error ? err.message : String(err) });
              }
            }}
          >
            {createNote.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            加笔记
          </Button>
        </div>
      </div>
    </section>
  );
}

function PhaseHint() {
  return (
    <section className="rounded-lg border bg-card p-4">
      <Badge variant="outline">Phase 1 已落地</Badge>
      <p className="mt-3 text-sm text-muted-foreground">
        Idea CRUD + 养护笔记 + 升级 Mission 已接真实数据。下一步：Phase 2 加录入入口（⌘ ⇧ I 全局快捷键 + 命令面板）。
      </p>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Promote Idea → Mission dialog
// ────────────────────────────────────────────────────────────────────────

function PromoteIdeaDialog({
  idea,
  notes,
  open,
  onOpenChange,
}: {
  idea: Idea;
  notes: IdeaNurtureNote[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wsId = useWorkspaceId();
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const promoteIdea = usePromoteIdea();
  const agentsQuery = useQuery(agentListOptions(wsId));
  const activeAgents = useMemo<Agent[]>(
    () => (agentsQuery.data ?? []).filter((a) => !a.archived_at),
    [agentsQuery.data],
  );

  // 默认负责人优先选「产品经理」种子 Agent，否则取第一个非归档 Agent。
  const defaultCaptainId = useMemo(() => {
    const captain = activeAgents.find((a) => a.name.includes("产品经理"));
    return captain?.id ?? activeAgents[0]?.id ?? "";
  }, [activeAgents]);

  const [title, setTitle] = useState(idea.title);
  const [captainId, setCaptainId] = useState(defaultCaptainId);
  const [memberIds, setMemberIds] = useState<string[]>([]);

  // agents 异步加载完才有 default captain，回填一次。
  useEffect(() => {
    if (!captainId && defaultCaptainId) setCaptainId(defaultCaptainId);
  }, [captainId, defaultCaptainId]);

  // 切换到另一条 idea 时重置标题和成员选择，避免 dialog 复用上一条 idea 的输入。
  // captain 沿用用户上次挑的（多次升级时一般是同一个负责人）。
  useEffect(() => {
    setTitle(idea.title);
    setMemberIds([]);
  }, [idea.id, idea.title]);

  const memberCandidates = activeAgents.filter((a) => a.id !== captainId);
  const submitting = promoteIdea.isPending;
  const canSubmit = !submitting && captainId && title.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await promoteIdea.mutateAsync({
        id: idea.id,
        title: title.trim(),
        captain_agent_id: captainId,
        member_agent_ids: memberIds,
      });
      toast.success("已升级为 Mission", {
        description: "已带入想法描述和养护笔记，团队房间第一条简报已发送。",
      });
      onOpenChange(false);
      navigation.push(paths.missions());
    } catch (err) {
      toast.error("升级失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (submitting) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>升级为 Mission</DialogTitle>
          <DialogDescription>
            选定负责人和成员，把想法带入团队房间继续推进。养护笔记会自动作为第一条简报。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="promote-title" className="text-xs">
              Mission 标题
            </Label>
            <Input
              id="promote-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="给这个 Mission 起个名字"
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">负责人（必选）</Label>
            <NativeSelect
              className="w-full"
              value={captainId}
              onChange={(e) => setCaptainId(e.target.value)}
              disabled={submitting || activeAgents.length === 0}
            >
              {activeAgents.length === 0 ? (
                <NativeSelectOption value="">暂无可用智能体</NativeSelectOption>
              ) : (
                activeAgents.map((agent) => (
                  <NativeSelectOption key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.model ? ` · ${agent.model}` : ""}
                  </NativeSelectOption>
                ))
              )}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">协作成员（可选）</Label>
            {memberCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">没有更多可加入的成员。</p>
            ) : (
              <div className="max-h-44 overflow-y-auto rounded-md border p-2">
                {memberCandidates.map((agent) => {
                  const checked = memberIds.includes(agent.id);
                  return (
                    <label
                      key={agent.id}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          if (v) {
                            setMemberIds((prev) => [...prev, agent.id]);
                          } else {
                            setMemberIds((prev) => prev.filter((id) => id !== agent.id));
                          }
                        }}
                        disabled={submitting}
                      />
                      <span className="flex-1 truncate">{agent.name}</span>
                      {agent.model ? (
                        <span className="text-xs text-muted-foreground">{agent.model}</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {notes.length > 0 ? (
            <div className="rounded-md bg-muted/40 p-3 text-xs">
              <div className="font-medium">将带入的养护笔记（{notes.length}）</div>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                {notes.slice(0, 3).map((n) => (
                  <li key={n.id} className="truncate">· {n.summary}</li>
                ))}
                {notes.length > 3 ? <li>… 还有 {notes.length - 3} 条</li> : null}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Network className="size-3.5" />}
            升级
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function labelForNoteKind(kind: IdeaNurtureNote["kind"]): string {
  switch (kind) {
    case "new_angle":
      return "新视角";
    case "related_history":
      return "相关历史";
    case "external_reference":
      return "外部参考";
    case "question":
      return "提问";
  }
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString();
}
