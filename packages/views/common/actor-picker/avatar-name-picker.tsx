"use client";

import { Check } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../actor-avatar";

export function AvatarNamePickerItem({
  actorType,
  actorId,
  label,
  description,
  selected,
  disabled,
  tooltip,
  rightSlot,
  onSelect,
  showStatusDot,
}: {
  actorType: "agent" | "member" | string;
  actorId: string;
  label: string;
  description?: string | null;
  selected: boolean;
  disabled?: boolean;
  tooltip?: React.ReactNode;
  rightSlot?: React.ReactNode;
  onSelect: () => void;
  showStatusDot?: boolean;
}) {
  const row = (
    <button
      type="button"
      data-picker-item
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
      )}
    >
      <ActorAvatar
        actorType={actorType}
        actorId={actorId}
        size={22}
        showStatusDot={showStatusDot ?? actorType === "agent"}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {rightSlot}
      <Check
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-muted-foreground",
          !selected && "invisible",
        )}
      />
    </button>
  );

  if (!tooltip) return row;

  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function AvatarNamePickerEmpty({
  children = "没有匹配项",
}: {
  children?: React.ReactNode;
}) {
  return (
    <div className="px-2 py-3 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
