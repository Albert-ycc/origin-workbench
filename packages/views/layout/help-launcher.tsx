"use client";

import { ArrowUpRight, CircleHelp, Code2, Scale } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { openExternal } from "../platform/open-external";

const UPSTREAM_REPO_URL = "https://github.com/multica-ai/multica";
const UPSTREAM_LICENSE_URL = "https://github.com/multica-ai/multica/blob/main/LICENSE";

// base-ui Menu Item closes the popover synchronously on click; deferring the
// outbound navigation to the next frame avoids the close-vs-IPC race where the
// item handler can be unmounted before the IPC promise is registered.
function openSoon(url: string) {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => openExternal(url));
}

export function HelpLauncher() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="关于"
        title="关于"
        className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <CircleHelp className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="min-w-60"
      >
        <div className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
          <div className="font-medium text-foreground">原点工作台 (Origin)</div>
          <div className="mt-0.5">Powered by Multica · Apache 2.0 (modified)</div>
          <div className="mt-0.5">© 2025 Multica, Inc.</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openSoon(UPSTREAM_REPO_URL)}>
          <Code2 className="h-3.5 w-3.5" />
          上游仓库
          <ArrowUpRight className="size-3 translate-y-px text-muted-foreground/50" />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openSoon(UPSTREAM_LICENSE_URL)}>
          <Scale className="h-3.5 w-3.5" />
          开源协议
          <ArrowUpRight className="size-3 translate-y-px text-muted-foreground/50" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
