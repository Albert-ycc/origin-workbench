"use client";

import { useMemo, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Brain, CheckCircle2, FolderKanban, Layers3 } from "lucide-react";
import type { Agent } from "@multica/core/types";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  projectAgentMemoriesOptions,
  projectV12ListOptions,
} from "@multica/core/projects-v12";
import { Badge } from "@multica/ui/components/ui/badge";
import { MemoryTab } from "./memory-tab";

export function AgentMemoryTab({ agent }: { agent: Agent }) {
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">记忆</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            执行过程中的发现先沉淀为候选记忆，再由人确认后进入长期记忆。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <MemoryLayerCard
            icon={<Layers3 className="size-4" />}
            title="工作区记忆"
            body="跨智能体共享的长期背景，例如你的偏好、团队规则、常用项目口径。"
          />
          <MemoryLayerCard
            icon={<Brain className="size-4" />}
            title="智能体记忆"
            body="这个智能体自己的角色经验，例如常犯错点、擅长领域、固定输出格式。"
          />
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">当前智能体记忆</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              已确认记忆会稳定注入；候选记忆需要确认后才算进入长期记忆。
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3" />
            人审后生效
          </span>
        </div>
        <MemoryTab agent={agent} />
      </section>
    </div>
  );
}

export function ProjectContextTab({ agent }: { agent: Agent }) {
  const wsId = useWorkspaceId();
  const { data: projects = [] } = useQuery(projectV12ListOptions(wsId));
  const trackedProjects = projects.slice(0, 6);
  const projectMemoryQueries = useQueries({
    queries: trackedProjects.map((project) =>
      projectAgentMemoriesOptions(wsId, project.id),
    ),
  });

  const projectRows = useMemo(
    () =>
      trackedProjects.map((project, index) => {
        const memories = projectMemoryQueries[index]?.data?.memories ?? [];
        const agentMemory =
          memories.find((memory) => memory.agent_id === agent.id) ?? null;
        return { project, agentMemory };
      }),
    [agent.id, projectMemoryQueries, trackedProjects],
  );

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-medium">上下文</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          同一个智能体进入不同项目时读取项目资料、数据库来源和历史决策，避免把 A 项目的口径带到 B 项目。
        </p>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">跨项目上下文</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              这里展示该智能体在每个项目里的项目记忆文档和智能体侧记。
            </p>
          </div>
          <Badge variant="outline">{projects.length} 个项目</Badge>
        </div>

        {projectRows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            还没有项目工作区。创建项目后，这里会显示该智能体在每个项目中的上下文状态。
          </div>
        ) : (
          <div className="space-y-2">
            {projectRows.map(({ project, agentMemory }) => (
              <div
                key={project.id}
                className="flex items-start gap-3 rounded-lg border bg-background p-3"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <FolderKanban className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {project.title}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {project.status}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {agentMemory?.content ||
                      project.memory_doc ||
                      "还没有项目记忆。项目主聊、Council 结论、Mission 完成和用户钉住片段会逐步沉淀到这里。"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground/80">
                    <span>
                      项目记忆：
                      {project.memory_doc ? "已建立" : "待建立"}
                    </span>
                    <span>
                      智能体侧记：
                      {agentMemory
                        ? `更新于 ${formatDate(agentMemory.updated_at)}`
                        : "待积累"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MemoryLayerCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}
