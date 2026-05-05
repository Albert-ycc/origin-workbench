"use client";

import { FileText, X } from "lucide-react";
import type { Skill } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";

export function SkillSlashMenu({
  skills,
  selectedIndex,
  onPick,
  className,
}: {
  skills: Skill[];
  selectedIndex: number;
  onPick: (skill: Skill) => void;
  className?: string;
}) {
  if (skills.length === 0) return null;

  return (
    <div
      className={cn(
        "absolute bottom-full left-0 z-40 mb-2 max-h-72 w-80 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg",
        className,
      )}
      role="listbox"
    >
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        技能
      </div>
      {skills.map((skill, i) => {
        const selected = i === selectedIndex;
        return (
          <button
            key={skill.id}
            type="button"
            role="option"
            aria-selected={selected}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(skill);
            }}
            className={cn(
              "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              selected ? "bg-muted" : "hover:bg-muted/60",
            )}
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">/{skill.name}</div>
              {skill.description && (
                <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {skill.description}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function SelectedSkillChips({
  skills,
  onRemove,
  className,
}: {
  skills: Skill[];
  onRemove: (skillId: string) => void;
  className?: string;
}) {
  if (skills.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {skills.map((skill) => (
        <span
          key={skill.id}
          className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/60 px-2 py-1 text-xs text-muted-foreground"
        >
          <FileText className="size-3 shrink-0" />
          <span className="truncate">使用技能 /{skill.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="-mr-1 size-4 text-muted-foreground hover:text-foreground"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRemove(skill.id)}
          >
            <X className="size-3" />
          </Button>
        </span>
      ))}
    </div>
  );
}
