"use client";

import { ChevronRight, GitBranch, Route, SplitSquareHorizontal } from "lucide-react";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import { PageHeader } from "../layout/page-header";
import { AppLink } from "../navigation";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";

export function ExplorationsPage() {
  const workspace = useCurrentWorkspace();
  const p = useWorkspacePaths();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <PageHeader className="gap-1.5">
        <WorkspaceAvatar name={workspace?.name ?? "O"} size="sm" />
        <span className="text-sm text-muted-foreground">Origin</span>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="text-sm font-medium">分叉探索</span>
      </PageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-lg border bg-card p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Route className="size-5" />
              </div>
              <div>
                <h1 className="text-base font-semibold">Branching Exploration</h1>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  同一目标下保留多条探索路径，让不同 Agent 试不同方案，再把结果、成本、风险和取舍汇总给用户。
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <ExplorationStep icon={GitBranch} title="开分叉" desc="从 Mission、Idea 或私聊抽出一个探索主题。" />
              <ExplorationStep icon={SplitSquareHorizontal} title="并行跑" desc="给不同 Agent 分配不同路线，互不覆盖上下文。" />
              <ExplorationStep icon={Route} title="合并判断" desc="输出对比表、推荐路径和被放弃原因。" />
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-lg border bg-card p-4">
              <Badge variant="outline">Phase 7</Badge>
              <p className="mt-3 text-sm text-muted-foreground">
                当前为产品入口。后续需要新增探索对象、分支事件、对比面板和可回溯证据。
              </p>
            </section>
            <section className="rounded-lg border bg-card p-4">
              <div className="text-sm font-semibold">常用入口</div>
              <div className="mt-3 grid gap-2">
                <Button variant="outline" render={<AppLink href={p.missions()} />}>
                  从 Mission 开始
                </Button>
                <Button variant="ghost" render={<AppLink href={p.ideas()} />}>
                  从想法池开始
                </Button>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function ExplorationStep({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Route;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <Icon className="size-4 text-muted-foreground" />
      <div className="mt-3 text-sm font-semibold">{title}</div>
      <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
