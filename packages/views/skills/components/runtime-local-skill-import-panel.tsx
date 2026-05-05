"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Download, FileText, HardDrive, Loader2 } from "lucide-react";
import type {
  AgentRuntime,
  RuntimeLocalSkillSummary,
  Skill,
} from "@multica/core/types";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  runtimeListOptions,
  runtimeLocalSkillsKeys,
  runtimeLocalSkillsOptions,
  resolveRuntimeLocalSkillImport,
} from "@multica/core/runtimes";
import {
  skillDetailOptions,
  workspaceKeys,
} from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Badge } from "@multica/ui/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";
import { toast } from "sonner";

function runtimeLabel(runtime: AgentRuntime): string {
  return `${runtime.name} (${runtime.provider})`;
}

// ---------------------------------------------------------------------------
// Skill row — checkbox on the left + click body to focus (and reveal the
// inline editor when this row is the only selected one).
// ---------------------------------------------------------------------------

function SkillItem({
  skill,
  selected,
  showEditor,
  onToggle,
  name,
  description,
  onNameChange,
  onDescriptionChange,
}: {
  skill: RuntimeLocalSkillSummary;
  selected: boolean;
  // Inline editor only renders when exactly this skill is selected (size === 1).
  // Multi-select hides the editor — batch import uses each skill's original
  // name + description from disk.
  showEditor: boolean;
  onToggle: () => void;
  name: string;
  description: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border transition-colors ${
        selected ? "border-primary bg-primary/5" : "hover:bg-accent/40"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          // Stop propagation so the inner checkbox click and the outer button
          // click don't both fire — we'd toggle twice and end up where we
          // started.
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5"
        />
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileText className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{skill.name}</span>
            <Badge variant="secondary">{skill.provider}</Badge>
          </div>
          {skill.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {skill.description}
            </p>
          )}
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {skill.source_path}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {skill.file_count} 个文件
        </Badge>
      </button>

      {showEditor && (
        <div className="space-y-2.5 border-t bg-card px-4 py-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              工作区技能名称
            </Label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={skill.name}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              描述
            </Label>
            <Textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="可选：说明智能体什么时候该使用这个技能。"
              rows={2}
              className="resize-none text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel — three-section layout: sticky top / scrollable middle / sticky bottom
//
// Multi-select model:
//   - selectedKeys: Set<string> — every checked skill is staged for import
//   - When size === 1, the inline editor opens for that skill so the user can
//     rename / rewrite description before importing.
//   - When size > 1, the editor stays closed; batch import uses each skill's
//     original name + description (no per-row editing for batch flow).
// ---------------------------------------------------------------------------

export function RuntimeLocalSkillImportPanel({
  onImported,
}: {
  // Called after a successful import. For single-skill imports we pass the
  // newly created Skill so callers can navigate to its detail page; for batch
  // imports we still call once with the last imported skill so callers (e.g.
  // the dialog parent) can close themselves.
  onImported?: (skill: Skill) => void;
}) {
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  // Only the runtime owner can browse + import local skills (server-side ACL).
  const localRuntimes = useMemo(
    () =>
      runtimes.filter(
        (r) =>
          r.runtime_mode === "local" &&
          (userId == null || r.owner_id === userId),
      ),
    [runtimes, userId],
  );

  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [importing, setImporting] = useState(false);

  // Default to the first local runtime once the list lands.
  useEffect(() => {
    setSelectedRuntimeId((prev) => prev || localRuntimes[0]?.id || "");
  }, [localRuntimes]);

  // Switching runtimes: clear stale selection and editor state.
  useEffect(() => {
    setSelectedKeys(new Set());
    setName("");
    setDescription("");
  }, [selectedRuntimeId]);

  const selectedRuntime = localRuntimes.find((r) => r.id === selectedRuntimeId);
  const canBrowseSkills =
    !!selectedRuntimeId && selectedRuntime?.status === "online";
  const skillsQuery = useQuery({
    ...runtimeLocalSkillsOptions(selectedRuntimeId || null),
    enabled: canBrowseSkills,
  });
  const runtimeSkills = useMemo(
    () => skillsQuery.data?.skills ?? [],
    [skillsQuery.data],
  );

  // Single-skill focus: the one-and-only selected skill, used to hydrate the
  // inline name/description editor. Null when 0 or >1 selections.
  const focusedSkill = useMemo(() => {
    if (selectedKeys.size !== 1) return null;
    const onlyKey = selectedKeys.values().next().value;
    return runtimeSkills.find((s) => s.key === onlyKey) ?? null;
  }, [selectedKeys, runtimeSkills]);

  // After a scan, auto-select the first skill so the Import button has a
  // valid target without requiring a click. Don't override an existing
  // selection (user may have already toggled).
  useEffect(() => {
    if (runtimeSkills.length === 0) return;
    if (selectedKeys.size > 0) return;
    const first = runtimeSkills[0]!;
    setSelectedKeys(new Set([first.key]));
    setName(first.name);
    setDescription(first.description ?? "");
  }, [runtimeSkills, selectedKeys.size]);

  const toggleSkill = (skill: RuntimeLocalSkillSummary) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(skill.key)) {
        next.delete(skill.key);
      } else {
        next.add(skill.key);
      }
      // Re-hydrate the editor when the new selection collapses to size 1.
      if (next.size === 1) {
        const onlyKey = next.values().next().value;
        const single = runtimeSkills.find((s) => s.key === onlyKey);
        if (single) {
          setName(single.name);
          setDescription(single.description ?? "");
        }
      }
      return next;
    });
  };

  const allSelected =
    runtimeSkills.length > 0 && selectedKeys.size === runtimeSkills.length;
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedKeys(new Set());
      setName("");
      setDescription("");
    } else {
      setSelectedKeys(new Set(runtimeSkills.map((s) => s.key)));
    }
  };

  const handleImport = async () => {
    if (!selectedRuntimeId || selectedKeys.size === 0) return;
    const targets = runtimeSkills.filter((s) => selectedKeys.has(s.key));
    if (targets.length === 0) return;
    // Single-skill flow keeps the user's edited name/description; batch flow
    // imports each skill with its original name + description from disk.
    const useUserEdits = targets.length === 1;

    setImporting(true);
    let successCount = 0;
    let lastImported: Skill | null = null;
    const failures: { name: string; error: string }[] = [];

    for (const skill of targets) {
      try {
        const result = await resolveRuntimeLocalSkillImport(selectedRuntimeId, {
          skill_key: skill.key,
          name: useUserEdits ? name.trim() || undefined : undefined,
          description: useUserEdits
            ? description.trim() || undefined
            : undefined,
        });
        // Seed the detail cache so navigation lands with data pre-populated.
        qc.setQueryData(
          skillDetailOptions(wsId, result.skill.id).queryKey,
          result.skill,
        );
        lastImported = result.skill;
        successCount++;
      } catch (error) {
        failures.push({
          name: skill.name,
          error: error instanceof Error ? error.message : "导入失败",
        });
      }
    }

    await Promise.all([
      qc.invalidateQueries({
        queryKey: runtimeLocalSkillsKeys.forRuntime(selectedRuntimeId),
      }),
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) }),
      qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) }),
    ]);

    if (failures.length === 0) {
      toast.success(
        successCount === 1 ? "技能已导入" : `已导入 ${successCount} 个技能`,
      );
    } else if (successCount === 0) {
      toast.error(
        failures.length === 1
          ? failures[0]!.error
          : `全部 ${failures.length} 个技能导入失败`,
      );
    } else {
      toast.error(
        `成功 ${successCount} 个，失败 ${failures.length} 个：${failures
          .map((f) => f.name)
          .join("、")}`,
      );
    }

    if (lastImported && successCount > 0) {
      onImported?.(lastImported);
    }

    setImporting(false);
    setSelectedKeys(new Set());
    setName("");
    setDescription("");
  };

  // Editing-name guard only matters for the single-skill flow — in batch flow
  // we don't ask for a name at all (we use each skill's original).
  const canImport =
    !!selectedRuntime &&
    selectedRuntime.status === "online" &&
    selectedKeys.size > 0 &&
    (selectedKeys.size > 1 || !!name.trim()) &&
    !importing;

  // --- Scroll fade for the middle region ---
  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeStyle = useScrollFade(scrollRef);

  // --- Middle body — depends on discovery state ---
  const middle = (() => {
    if (localRuntimes.length === 0) {
      return (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            暂无可用的本地运行环境
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            连接本地运行环境后，即可浏览并导入其中的本地技能。
          </p>
        </div>
      );
    }
    if (!selectedRuntime) {
      return (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            选择一个运行环境继续
          </p>
        </div>
      );
    }
    if (selectedRuntime.status !== "online") {
      return (
        <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          运行环境必须在线，才能浏览本地技能。
        </div>
      );
    }
    if (skillsQuery.isLoading) {
      return (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-48" />
            </div>
          ))}
        </div>
      );
    }
    if (skillsQuery.error) {
      return (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {skillsQuery.error instanceof Error
            ? skillsQuery.error.message
            : "加载运行环境本地技能失败"}
        </div>
      );
    }
    if (!skillsQuery.data?.supported) {
      return (
        <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          这个运行环境提供方暂不支持暴露本地技能清单。
        </div>
      );
    }
    if (runtimeSkills.length === 0) {
      return (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">未找到本地技能</p>
          <p className="mt-1 text-xs text-muted-foreground">
            这个运行环境暂时没有可发现的本地技能。
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>
            发现 {runtimeSkills.length} 个本地技能
            {selectedKeys.size > 0 && (
              <>
                {" "}
                · 已选 {selectedKeys.size} 个
              </>
            )}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={toggleSelectAll}
            className="h-6 px-2 text-xs"
          >
            {allSelected ? "取消全选" : "全选"}
          </Button>
        </div>
        {runtimeSkills.map((s) => (
          <SkillItem
            key={s.key}
            skill={s}
            selected={selectedKeys.has(s.key)}
            showEditor={focusedSkill?.key === s.key}
            onToggle={() => toggleSkill(s)}
            name={focusedSkill?.key === s.key ? name : ""}
            description={focusedSkill?.key === s.key ? description : ""}
            onNameChange={setName}
            onDescriptionChange={setDescription}
          />
        ))}
      </div>
    );
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky top: runtime picker + status */}
      <div
        // While importing, lock the whole runtime/skill selection so the user
        // can't switch targets out from under the in-flight request.
        aria-disabled={importing || undefined}
        className={`shrink-0 space-y-2 border-b px-5 py-3 ${
          importing ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">运行环境</Label>
          <Select
            value={selectedRuntimeId}
            onValueChange={(v) => v && setSelectedRuntimeId(v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择本地运行环境">
                {selectedRuntime ? runtimeLabel(selectedRuntime) : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {localRuntimes.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {runtimeLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedRuntime && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {runtimeLabel(selectedRuntime)}
            </span>
            <Badge
              variant={
                selectedRuntime.status === "online" ? "secondary" : "outline"
              }
            >
              {selectedRuntime.status}
            </Badge>
          </div>
        )}
      </div>

      {/* Scrollable middle — also locked during import. */}
      <div
        ref={scrollRef}
        style={fadeStyle}
        aria-disabled={importing || undefined}
        className={`flex-1 min-h-0 overflow-y-auto px-5 py-3 ${
          importing ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {middle}
        <p className="mt-3 text-xs text-muted-foreground">
          导入时会忽略符号链接、无法读取的文件、超大文件和体积过大的目录。
        </p>
      </div>

      {/* Sticky bottom: Import button + context */}
      <div className="flex shrink-0 items-center gap-3 border-t bg-muted/30 px-5 py-3">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {selectedKeys.size === 0 ? (
            "选择一个或多个技能继续。"
          ) : selectedKeys.size === 1 && focusedSkill ? (
            <>
              准备将{" "}
              <span className="font-medium text-foreground">
                {name.trim() || focusedSkill.name}
              </span>{" "}
              导入到当前工作区。
            </>
          ) : (
            <>
              准备导入{" "}
              <span className="font-medium text-foreground">
                {selectedKeys.size}
              </span>{" "}
              个技能到当前工作区。
            </>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleImport}
          disabled={!canImport}
        >
          {importing ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              正在导入…
            </>
          ) : (
            <>
              <Download className="h-3 w-3" />
              {selectedKeys.size > 1
                ? `导入选中 ${selectedKeys.size} 个`
                : "导入到工作区"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
