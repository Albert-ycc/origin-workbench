"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import type { Agent, RuntimeDevice } from "@multica/core/types";
import { createSafeId } from "@multica/core/utils";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { toast } from "sonner";

interface ArgEntry {
  id: string;
  value: string;
}

function argsToEntries(args: string[]): ArgEntry[] {
  return args.map((value) => ({ id: createSafeId(), value }));
}

// Each row may contain a single arg ("--model") or several space-separated
// tokens ("--model claude-sonnet-4"). We split on whitespace so users can
// paste multi-token flags into one row without having to break them apart
// manually. The placeholder + helper text explain this so users aren't
// surprised when "--flag value" lands as two args at the back-end.
function entriesToArgs(entries: ArgEntry[]): string[] {
  return entries.flatMap((e) => e.value.trim().split(/\s+/)).filter(Boolean);
}

export function CustomArgsTab({
  agent,
  runtimeDevice,
  onSave,
  onDirtyChange,
}: {
  agent: Agent;
  runtimeDevice?: RuntimeDevice;
  onSave: (updates: Partial<Agent>) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [entries, setEntries] = useState<ArgEntry[]>(
    argsToEntries(agent.custom_args ?? []),
  );
  const [saving, setSaving] = useState(false);

  const currentArgs = entriesToArgs(entries);
  const originalArgs = agent.custom_args ?? [];
  const dirty = JSON.stringify(currentArgs) !== JSON.stringify(originalArgs);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const addEntry = () => {
    setEntries([...entries, { id: createSafeId(), value: "" }]);
  };

  const removeEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, value: string) => {
    setEntries(
      entries.map((entry, i) => (i === index ? { ...entry, value } : entry)),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ custom_args: currentArgs });
      toast.success("自定义参数已保存");
    } catch {
      toast.error("保存自定义参数失败");
    } finally {
      setSaving(false);
    }
  };

  const launchHeader = runtimeDevice?.launch_header;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            启动时追加到智能体命令的 CLI 参数。多个 token 可以写在同一行，
            传给 CLI 前会按空白拆分。
          </p>
          {launchHeader && (
            <p className="text-xs text-muted-foreground">
              启动模式：{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                {launchHeader} &lt;your args&gt;
              </code>
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addEntry}
          className="shrink-0"
        >
          <Plus className="h-3 w-3" />
          添加
        </Button>
      </div>

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((entry, index) => (
            <div key={entry.id} className="flex items-center gap-2">
              <Input
                value={entry.value}
                onChange={(e) => updateEntry(index, e.target.value)}
                placeholder="--flag value"
                className="flex-1 font-mono text-xs"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeEntry(index)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="移除参数"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {dirty && (
          <span className="text-xs text-muted-foreground">有未保存的修改</span>
        )}
        <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          保存
        </Button>
      </div>
    </div>
  );
}
