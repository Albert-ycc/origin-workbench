"use client";

import { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { AVATAR_SET, AVATAR_SET_SIZE } from "./avatar-set";

export const AVATARS_PER_PAGE = 10;

interface AvatarPickerProps {
  /** Currently selected avatar URL (data-uri or http). Undefined = none selected. */
  value?: string;
  onChange: (url: string) => void;
  /** Optional id prefix for accessibility ids when reused on the same page. */
  idPrefix?: string;
  /** Override the size of each avatar tile (px). Default 56. */
  tileSize?: number;
  className?: string;
}

/**
 * Pick a random subset of `AVATARS_PER_PAGE` avatars from the AVATAR_SET pool.
 * Pulled out of the component body so the initial state is computed lazily and
 * each refresh produces a fresh shuffle without re-rendering the parent.
 */
function pickRandomBatch(): string[] {
  // Fisher–Yates partial shuffle: O(n) but only swaps the first PER_PAGE slots,
  // which is enough since we only need the first PER_PAGE elements of the pool.
  const indices = AVATAR_SET.map((_, i) => i);
  const take = Math.min(AVATARS_PER_PAGE, AVATAR_SET_SIZE);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (indices.length - i));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  return indices.slice(0, take).map((i) => AVATAR_SET[i]!.url);
}

export function AvatarPicker({
  value,
  onChange,
  idPrefix = "avatar",
  tileSize = 56,
  className,
}: AvatarPickerProps) {
  const [batch, setBatch] = useState<string[]>(() => pickRandomBatch());

  // If the currently-selected avatar is not in the visible batch, prepend it
  // so the user always sees their selection (without forcing a reshuffle every
  // time the value changes externally).
  const visibleBatch = useMemo(() => {
    if (value && !batch.includes(value)) {
      return [value, ...batch].slice(0, AVATARS_PER_PAGE);
    }
    return batch;
  }, [value, batch]);

  const handleRefresh = useCallback(() => {
    setBatch(pickRandomBatch());
  }, []);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          从 {AVATAR_SET_SIZE} 个头像里挑一个
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleRefresh}
          className="h-7 gap-1.5 text-xs"
        >
          <RefreshCw className="size-3" />
          换一批
        </Button>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {visibleBatch.map((url, idx) => {
          const selected = value === url;
          return (
            <button
              key={`${idPrefix}-${idx}-${url.slice(-32)}`}
              type="button"
              onClick={() => onChange(url)}
              className={cn(
                "flex items-center justify-center rounded-full border-2 transition-all",
                selected
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-transparent bg-muted hover:bg-muted/70",
              )}
              style={{ width: tileSize, height: tileSize }}
              aria-pressed={selected}
              aria-label={`头像 ${idx + 1}`}
            >
              <img
                src={url}
                alt=""
                className="rounded-full"
                style={{ width: tileSize - 6, height: tileSize - 6 }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Pick a deterministic default avatar from the AVATAR_SET based on a seed
 * (typically the user's display name). Used as the fallback when no avatar
 * has been chosen yet — guarantees the same name always maps to the same
 * default avatar for visual stability.
 */
export function defaultAvatarFor(seed?: string | null): string {
  const safeSeed = (seed?.trim() || "origin-local-user");
  let hash = 2166136261;
  for (let i = 0; i < safeSeed.length; i++) {
    hash ^= safeSeed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const index = (hash >>> 0) % AVATAR_SET_SIZE;
  return AVATAR_SET[index]!.url;
}
