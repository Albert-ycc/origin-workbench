"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpen,
  ExternalLink,
  Folder,
  Frame,
  Loader2,
  Network,
  Plus,
  ScrollText,
  Trash2,
  Wrench,
} from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  toolBindingListOptions,
  useCreateToolBinding,
  useDeleteToolBinding,
  useUpdateToolBinding,
} from "@multica/core/tool-bindings";
import type {
  ToolBinding,
  ToolBindingFilter,
  ToolBindingType,
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@multica/ui/components/ui/native-select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Switch } from "@multica/ui/components/ui/switch";
import { cn } from "@multica/ui/lib/utils";
import { openExternal } from "../platform/open-external";

const TOOL_TYPE_OPTIONS: Array<{
  value: ToolBindingType;
  label: string;
  placeholder: string;
}> = [
  { value: "lark_doc", label: "飞书文档", placeholder: "https://xxx.feishu.cn/docx/..." },
  { value: "lark_whiteboard", label: "飞书画板", placeholder: "https://xxx.feishu.cn/board/..." },
  { value: "figma_file", label: "Figma 文件", placeholder: "https://figma.com/file/..." },
  { value: "obsidian_note", label: "Obsidian 笔记", placeholder: "/Volumes/<redacted>/Norma/note.md" },
  { value: "local_repo", label: "本地仓库", placeholder: "/Users/you/code/repo" },
];

const TYPE_LABEL: Record<ToolBindingType, string> = {
  lark_doc: "飞书文档",
  lark_whiteboard: "飞书画板",
  figma_file: "Figma",
  obsidian_note: "Obsidian",
  local_repo: "本地仓库",
};

function ToolIcon({ type, className }: { type: ToolBindingType; className?: string }) {
  switch (type) {
    case "lark_doc":
      return <ScrollText className={className} />;
    case "lark_whiteboard":
      return <Network className={className} />;
    case "figma_file":
      return <Frame className={className} />;
    case "obsidian_note":
      return <BookOpen className={className} />;
    case "local_repo":
      return <Folder className={className} />;
    default:
      return <Wrench className={className} />;
  }
}

export interface ToolBindingsPanelProps {
  // 单一 subject — 互斥，跟后端 CHECK 约束一致。
  subject:
    | { kind: "mission"; id: string }
    | { kind: "agent"; id: string }
    | { kind: "idea"; id: string }
    | { kind: "council"; id: string };
  className?: string;
}

export function ToolBindingsPanel({ subject, className }: ToolBindingsPanelProps) {
  const wsId = useWorkspaceId();
  const filter: ToolBindingFilter = subjectFilter(subject);
  const query = useQuery(toolBindingListOptions(wsId, filter));
  const [open, setOpen] = useState(false);

  const bindings = query.data ?? [];

  return (
    <section className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">绑定的工具</h3>
          {bindings.length > 0 ? (
            <Badge variant="outline" className="text-[10px]">
              {bindings.length}
            </Badge>
          ) : null}
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" />
          加
        </Button>
      </div>

      <CreateToolBindingDialog subject={subject} open={open} onOpenChange={setOpen} />

      <div className="mt-3 space-y-2">
        {query.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : bindings.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            还没有绑定任何工具。把这个对象关联到飞书 PRD、Figma 文件、Obsidian 笔记或本地仓库，让 Agent 在派工时能直达。
          </p>
        ) : (
          bindings.map((b) => <ToolBindingRow key={b.id} binding={b} />)
        )}
      </div>
    </section>
  );
}

function ToolBindingRow({ binding }: { binding: ToolBinding }) {
  const update = useUpdateToolBinding();
  const remove = useDeleteToolBinding();
  const refUrl = typeof binding.resource_ref?.url === "string" ? binding.resource_ref.url : "";
  const fallbackPath = typeof binding.resource_ref?.path === "string" ? binding.resource_ref.path : "";
  const display = binding.label || refUrl || fallbackPath || TYPE_LABEL[binding.tool_type];
  const subUrl = refUrl || fallbackPath;

  return (
    <div className="rounded-md border bg-background p-2.5 text-xs">
      <div className="flex items-center gap-2">
        <ToolIcon type={binding.tool_type} className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-medium">
            <span className="truncate">{display}</span>
            {refUrl ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-primary"
                onClick={() => openExternal(refUrl)}
                title="在外部打开"
              >
                <ExternalLink className="size-3" />
              </button>
            ) : null}
          </div>
          {subUrl && subUrl !== display ? (
            <div className="truncate text-muted-foreground">{subUrl}</div>
          ) : (
            <div className="text-muted-foreground">{TYPE_LABEL[binding.tool_type]}</div>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-1 text-destructive hover:text-destructive"
          onClick={async () => {
            if (!window.confirm(`删除「${display}」绑定？`)) return;
            try {
              await remove.mutateAsync(binding.id);
              toast.success("已删除");
            } catch (err) {
              toast.error("删除失败", {
                description: err instanceof Error ? err.message : String(err),
              });
            }
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Label htmlFor={`write-${binding.id}`} className="text-[11px] text-muted-foreground">
          允许写入（agent 可推送变更）
        </Label>
        <Switch
          id={`write-${binding.id}`}
          checked={binding.write_enabled}
          onCheckedChange={async (v) => {
            try {
              await update.mutateAsync({ id: binding.id, write_enabled: v });
            } catch (err) {
              toast.error("切换失败", {
                description: err instanceof Error ? err.message : String(err),
              });
            }
          }}
        />
      </div>
    </div>
  );
}

function CreateToolBindingDialog({
  subject,
  open,
  onOpenChange,
}: {
  subject: ToolBindingsPanelProps["subject"];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useCreateToolBinding();
  const [type, setType] = useState<ToolBindingType>("lark_doc");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!open) {
      setType("lark_doc");
      setUrl("");
      setLabel("");
    }
  }, [open]);

  const submitting = create.isPending;
  const placeholder =
    TOOL_TYPE_OPTIONS.find((o) => o.value === type)?.placeholder ?? "";
  const canSubmit = !submitting && url.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>绑定外部工具</DialogTitle>
          <DialogDescription>
            把飞书 / Figma / Obsidian / 本地仓库关联进来。绑定默认只读，确认后再开「允许写入」。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">工具类型</Label>
            <NativeSelect
              className="w-full"
              value={type}
              onChange={(e) => setType(e.target.value as ToolBindingType)}
              disabled={submitting}
            >
              {TOOL_TYPE_OPTIONS.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="binding-url" className="text-xs">URL 或路径</Label>
            <Input
              id="binding-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={placeholder}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="binding-label" className="text-xs">标签（可选）</Label>
            <Input
              id="binding-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="给这个绑定起个好认的名字，比如「营养库 PRD」"
              disabled={submitting}
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
                  tool_type: type,
                  resource_ref: buildResourceRef(type, url.trim()),
                  label: label.trim() || undefined,
                  ...subjectField(subject),
                });
                toast.success("已绑定");
                onOpenChange(false);
              } catch (err) {
                toast.error("绑定失败", {
                  description: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            绑定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildResourceRef(type: ToolBindingType, value: string) {
  // 后端不强制 shape，前端按 tool_type 把 URL/path 放到约定字段里。
  switch (type) {
    case "obsidian_note":
    case "local_repo":
      return { path: value };
    default:
      return { url: value };
  }
}

function subjectFilter(subject: ToolBindingsPanelProps["subject"]): ToolBindingFilter {
  switch (subject.kind) {
    case "mission":
      return { mission_id: subject.id };
    case "agent":
      return { agent_id: subject.id };
    case "idea":
      return { idea_id: subject.id };
    case "council":
      return { council_session_id: subject.id };
  }
}

function subjectField(subject: ToolBindingsPanelProps["subject"]) {
  switch (subject.kind) {
    case "mission":
      return { mission_id: subject.id };
    case "agent":
      return { agent_id: subject.id };
    case "idea":
      return { idea_id: subject.id };
    case "council":
      return { council_session_id: subject.id };
  }
}
