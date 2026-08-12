"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Cpu, Loader2, Plus, Check } from "lucide-react";
import {
  aggregateRuntimeModelsOptions,
  type AggregatedRuntimeModel,
} from "@multica/core/runtimes";
import type { AgentRuntime } from "@multica/core/types";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@multica/ui/components/ui/popover";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";

// ModelDropdown renders a searchable, creatable model picker that spans
// every runnable provider. It aggregates the model catalogs of all online
// API runtimes (read from metadata, zero network) and online cloud runtimes
// (enumerated via the daemon), grouping them by runtime. Selecting a model
// reports both the model id and its runtime id so the caller can persist a
// `runtime_id` + `model` update in one shot.
export function ModelDropdown({
  runtimes,
  runtimeId,
  value,
  onChange,
  disabled,
}: {
  runtimes: AgentRuntime[];
  /** Currently bound runtime — used only for the trigger / custom-input label. */
  runtimeId: string | null;
  value: string;
  onChange: (model: string, runtimeId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const modelsQuery = useQuery(aggregateRuntimeModelsOptions(runtimes));
  const models = useMemo(
    () => modelsQuery.data ?? [],
    [modelsQuery.data],
  );
  const grouped = useMemo(() => groupByRuntime(models), [models]);

  const filtered = useMemo(() => {
    if (!search.trim()) return grouped;
    const needle = search.toLowerCase();
    return grouped
      .map((group) => ({
        ...group,
        models: group.models.filter(
          (m) =>
            m.id.toLowerCase().includes(needle) ||
            m.label.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.models.length > 0);
  }, [grouped, search]);

  const trimmedSearch = search.trim();
  const exactMatch = models.some(
    (m) => m.id === trimmedSearch || m.label === trimmedSearch,
  );
  // Custom model creation requires a bound runtime: without one, "use X"
  // would report an empty runtime_id and clear the required capability
  // source in the create-agent form.
  const hasRuntime = Boolean(runtimeId);
  const canCreate = hasRuntime && trimmedSearch.length > 0 && !exactMatch;

  const select = (id: string, nextRuntimeId: string) => {
    onChange(id, nextRuntimeId);
    setOpen(false);
    setSearch("");
  };

  const triggerLabel =
    value ||
    (disabled
      ? "选择运行环境后可选模型"
      : runtimeId
        ? "默认（provider）"
        : "默认（随运行环境）");

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">模型</Label>
        {modelsQuery.isError && (
          <span className="text-xs text-muted-foreground">发现失败</span>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 mt-1.5 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{triggerLabel}</div>
            {value && (
              <div className="truncate text-xs text-muted-foreground">
                {modelMeta(models, value)}
              </div>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--anchor-width)] p-0 overflow-hidden"
        >
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              placeholder="搜索或输入模型 ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {modelsQuery.isLoading && (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在发现模型…
              </div>
            )}

            {!modelsQuery.isLoading &&
              filtered.map((group) => (
                <div key={group.runtime_id} className="mb-1">
                  <div className="px-2 pt-1.5 pb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.runtime_name}
                  </div>
                  {group.models.map((m) => (
                    <button
                      key={`${group.runtime_id}-${m.id}`}
                      onClick={() => select(m.id, m.runtime_id)}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        m.id === value ? "bg-accent" : "hover:bg-accent/50"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{m.label}</span>
                          {m.default && (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                              默认
                            </span>
                          )}
                        </div>
                        {(m.provider || m.label !== m.id) && (
                          <div className="truncate text-xs text-muted-foreground">
                            {m.provider ?? m.id}
                          </div>
                        )}
                      </div>
                      {m.id === value && (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              ))}

            {/* No bound runtime yet — a custom model value can't be created
                without one, so point the user at the capability source. */}
            {!hasRuntime && trimmedSearch.length > 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                请先在能力来源选择运行环境
              </div>
            )}

            {!modelsQuery.isLoading &&
              filtered.length === 0 &&
              trimmedSearch.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  没有可用模型。
                </div>
              )}

            {canCreate && (
              <button
                onClick={() => select(trimmedSearch, runtimeId ?? "")}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-accent/50"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  使用“{trimmedSearch}”
                </span>
              </button>
            )}

            {value && (
              <button
                onClick={() => select("", runtimeId ?? "")}
                className="mt-1 flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50"
              >
                清空选择（使用提供商默认值）
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function groupByRuntime(models: AggregatedRuntimeModel[]): Array<{
  runtime_id: string;
  runtime_name: string;
  models: AggregatedRuntimeModel[];
}> {
  const order: string[] = [];
  const map = new Map<string, { runtime_name: string; models: AggregatedRuntimeModel[] }>();
  for (const m of models) {
    let entry = map.get(m.runtime_id);
    if (!entry) {
      entry = { runtime_name: m.runtime_name, models: [] };
      map.set(m.runtime_id, entry);
      order.push(m.runtime_id);
    }
    entry.models.push(m);
  }
  return order.map((id) => {
    const entry = map.get(id)!;
    return { runtime_id: id, runtime_name: entry.runtime_name, models: entry.models };
  });
}

function modelMeta(models: AggregatedRuntimeModel[], id: string): string {
  const found = models.find((m) => m.id === id);
  if (!found) return "custom";
  return found.runtime_name || found.provider || "model";
}
