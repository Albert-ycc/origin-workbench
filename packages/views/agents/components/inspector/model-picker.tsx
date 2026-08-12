"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import {
  aggregateRuntimeModelsOptions,
  type AggregatedRuntimeModel,
} from "@multica/core/runtimes";
import type { AgentRuntime } from "@multica/core/types";
import { Input } from "@multica/ui/components/ui/input";
import {
  PickerItem,
  PropertyPicker,
} from "../../../issues/components/pickers";
import { CHIP_CLASS } from "./chip";

/**
 * Inline model picker for the agent inspector. Lighter cousin of
 * `ModelDropdown` (which is used in the create-agent dialog) — same
 * aggregated data source, but renders inside a PropertyPicker so it fits a
 * single PropRow. Selecting a model reports both the model id and the
 * runtime id so the inspector can persist `runtime_id` + `model` together.
 */
export function ModelPicker({
  runtimes,
  runtimeId,
  value,
  canEdit = true,
  onChange,
}: {
  runtimes: AgentRuntime[];
  /** Currently bound runtime — used for the custom-input / clear label. */
  runtimeId: string | null;
  value: string;
  /** When false, render a static read-only display and skip the popover. */
  canEdit?: boolean;
  onChange: (model: string, runtimeId: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const modelsQuery = useQuery(aggregateRuntimeModelsOptions(runtimes));
  // Memoise the model list so every downstream useMemo gets a stable
  // reference; `?? []` would mint a fresh array on every render and
  // invalidate filters needlessly.
  const models = useMemo(
    () => modelsQuery.data ?? [],
    [modelsQuery.data],
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return models;
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(s) || m.label.toLowerCase().includes(s),
    );
  }, [models, search]);

  const trimmedSearch = search.trim();
  const exactMatch = models.some(
    (m) => m.id === trimmedSearch || m.label === trimmedSearch,
  );
  const canCreate = trimmedSearch.length > 0 && !exactMatch;

  const select = async (model: AggregatedRuntimeModel) => {
    setOpen(false);
    setSearch("");
    if (model.id !== value) await onChange(model.id, model.runtime_id);
  };

  const selectCustom = async (id: string) => {
    setOpen(false);
    setSearch("");
    if (id !== value) await onChange(id, runtimeId ?? "");
  };

  const triggerLabel = value || "默认";
  const triggerTitle = `模型 · ${triggerLabel}`;

  if (!canEdit) {
    return (
      <span
        className="min-w-0 truncate px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
        title={triggerTitle}
      >
        {triggerLabel}
      </span>
    );
  }

  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      width="w-auto min-w-[16rem] max-w-md"
      align="start"
      tooltip={triggerTitle}
      triggerRender={
        <button
          type="button"
          className={CHIP_CLASS}
          aria-label={triggerTitle}
        />
      }
      trigger={
        <span className="min-w-0 truncate font-mono text-[11px]">
          {triggerLabel}
        </span>
      }
      header={
        <div className="p-1.5">
          <Input
            autoFocus
            placeholder="搜索或输入模型 ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      }
    >
      {modelsQuery.isLoading && (
        <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          正在发现模型…
        </div>
      )}

      {!modelsQuery.isLoading &&
        filtered.map((m) => (
          <PickerItem
            key={`${m.runtime_id}-${m.id}`}
            selected={m.id === value}
            onClick={() => void select(m)}
            // Tooltip carries the runtime + canonical model id even when the
            // chip shows the friendlier label, so users can always see what
            // string actually ships to the agent and where it runs.
            tooltip={`${m.runtime_name} · ${m.label !== m.id ? `${m.label} · ${m.id}` : m.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium">{m.label}</span>
                {m.default && (
                  <span className="shrink-0 rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">
                    默认
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {m.runtime_name}
              </div>
            </div>
          </PickerItem>
        ))}

      {!modelsQuery.isLoading && filtered.length === 0 && !canCreate && (
        <p className="px-3 py-3 text-center text-xs text-muted-foreground">
          没有可用模型
        </p>
      )}

      {canCreate && (
        <PickerItem
          selected={false}
          onClick={() => void selectCustom(trimmedSearch)}
          tooltip={`使用“${trimmedSearch}”作为自定义模型 ID`}
        >
          <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate text-primary">
            使用&ldquo;{trimmedSearch}&rdquo;
          </span>
        </PickerItem>
      )}

      {value && (
        <button
          type="button"
          onClick={() => void selectCustom("")}
          className="mt-1 flex w-full items-center border-t px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50"
          title="清空并回退到运行环境的提供商默认值"
        >
          清空（使用提供商默认值）
        </button>
      )}
    </PropertyPicker>
  );
}
