"use client";

import { useEffect, useState } from "react";
import { Check, FileText } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Agent } from "@multica/core/types";
import { api } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  skillListOptions,
  workspaceKeys,
} from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";

/**
 * Single source of truth for "attach workspace skills to this agent".
 * Used by both:
 *   - SkillsTab — full surface, "Add skill" button
 *   - Inspector → SkillAttach — inline dashed `+ Attach` chip
 *
 * Owns the workspace-skill list query, the "what's still attachable" filter,
 * the API call, and the optimistic invalidation. Callers only manage the
 * open/close state — they don't repeat the attach logic.
 */
export function SkillAddDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: Agent;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const { data: workspaceSkills = [] } = useQuery(skillListOptions(wsId));
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const agentSkillIds = new Set(agent.skills.map((s) => s.id));
  const availableSkills = workspaceSkills.filter(
    (s) => !agentSkillIds.has(s.id),
  );
  const allSelected =
    availableSkills.length > 0 &&
    availableSkills.every((skill) => selectedIds.includes(skill.id));

  useEffect(() => {
    if (!open) setSelectedIds([]);
  }, [open]);

  const toggleSkill = (skillId: string) => {
    setSelectedIds((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId],
    );
  };

  const toggleSelectAll = () => {
    setSelectedIds(
      allSelected ? [] : availableSkills.map((skill) => skill.id),
    );
  };

  const handleAddSelected = async () => {
    if (selectedIds.length === 0) return;
    setSaving(true);
    try {
      const newIds = [...agent.skills.map((s) => s.id), ...selectedIds];
      await api.setAgentSkills(agent.id, { skill_ids: newIds });
      qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加技能失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">批量添加技能</DialogTitle>
          <DialogDescription className="text-xs">
            选择一个或多个工作区技能，一次性分配给这个智能体。
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{availableSkills.length} 个可添加技能</span>
          {availableSkills.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
              disabled={saving}
            >
              {allSelected ? "取消全选" : "全选"}
            </Button>
          )}
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {availableSkills.map((skill) => {
            const selected = selectedIds.includes(skill.id);
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => toggleSkill(skill.id)}
                disabled={saving}
                aria-pressed={selected}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selected ? "bg-primary/10" : "hover:bg-accent/50"
                }`}
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded border ${
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-transparent"
                  }`}
                >
                  <Check className="size-3" />
                </span>
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{skill.name}</div>
                  {skill.description && (
                    <div className="truncate text-xs text-muted-foreground">
                      {skill.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          {availableSkills.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              所有工作区技能都已经分配给这个智能体。
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleAddSelected}
            disabled={selectedIds.length === 0 || saving}
          >
            添加选中的 {selectedIds.length} 项
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
