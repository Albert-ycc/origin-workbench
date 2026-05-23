"use client";

import { useState, type ReactNode } from "react";
import {
  Activity,
  BookOpenText,
  Brain,
  Cpu,
  FileText,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  Monitor,
  Settings2,
} from "lucide-react";
import type { Agent, AgentRuntime, MemberWithUser } from "@multica/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { Badge } from "@multica/ui/components/ui/badge";
import { ActivityTab } from "./tabs/activity-tab";
import { JournalTab } from "./tabs/journal-tab";
import {
  ModelSettingsTab,
  RuntimeSettingsTab,
} from "./tabs/model-runtime-tab";
import { InstructionsTab } from "./tabs/instructions-tab";
import { SkillsTab } from "./tabs/skills-tab";
import { AgentMemoryTab, ProjectContextTab } from "./tabs/memory-context-tab";
import { EnvTab } from "./tabs/env-tab";
import { CustomArgsTab } from "./tabs/custom-args-tab";
import {
  hasModelCliOverride,
  ModelConflictWarning,
} from "./tabs/model-conflict-warning";

type DetailTab =
  | "overview"
  | "journal"
  | "model"
  | "runtime"
  | "instructions"
  | "skills"
  | "memory"
  | "context"
  | "env"
  | "custom_args";

const detailTabs: {
  id: DetailTab;
  label: string;
  icon: typeof FileText;
}[] = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "journal", label: "工作记录", icon: Activity },
  { id: "model", label: "模型", icon: Cpu },
  { id: "runtime", label: "运行环境", icon: Monitor },
  { id: "instructions", label: "指令", icon: BookOpenText },
  { id: "skills", label: "技能", icon: FileText },
  { id: "memory", label: "记忆", icon: Brain },
  { id: "context", label: "上下文", icon: FolderKanban },
  { id: "env", label: "环境变量", icon: KeyRound },
  { id: "custom_args", label: "自定义参数", icon: Settings2 },
];

interface AgentOverviewPaneProps {
  agent: Agent;
  runtimes: AgentRuntime[];
  members: MemberWithUser[];
  currentUserId: string | null;
  canEdit: boolean;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
}

/**
 * Right pane on the agent detail page. The tabs now follow product concepts
 * instead of raw storage tables: overview, work record, model/runtime,
 * model, runtime, instructions, skills, memory, context, env, and custom args.
 *
 * **Unsaved-changes guard**: every config tab reports its dirty state up via
 * `onDirtyChange`. Switching to another tab while the active tab is dirty
 * pops a confirm dialog — without it, switching tabs would silently drop
 * unsaved edits because each tab manages its own local state and remounts on
 * tab change.
 */
export function AgentOverviewPane({
  agent,
  runtimes,
  members,
  currentUserId,
  canEdit,
  onUpdate,
}: AgentOverviewPaneProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [activeDirty, setActiveDirty] = useState(false);
  // Holds the destination when a tab change is intercepted by the dirty
  // guard. Null means no pending change. The AlertDialog reads non-null as
  // "open".
  const [pendingTab, setPendingTab] = useState<DetailTab | null>(null);

  const runtime = agent.runtime_id
    ? runtimes.find((r) => r.id === agent.runtime_id) ?? null
    : null;

  const requestTabChange = (next: DetailTab) => {
    if (next === activeTab) return;
    if (activeDirty) {
      setPendingTab(next);
      return;
    }
    setActiveTab(next);
  };

  const commitTabChange = () => {
    if (pendingTab) {
      setActiveTab(pendingTab);
      // The new tab mounts fresh; its effect will report its own dirty state.
      // We pre-clear so the guard can't trip from stale state on the way in.
      setActiveDirty(false);
      setPendingTab(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
      <div className="flex shrink-0 items-center gap-0 overflow-x-auto border-b px-4">
        {detailTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={activeTab === tab.id}
            onClick={() => requestTabChange(tab.id)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "overview" && (
          <TabContent wide>
            <OverviewTab agent={agent} runtimes={runtimes} />
          </TabContent>
        )}
        {activeTab === "journal" && (
          <JournalTab agent={agent} />
        )}
        {activeTab === "model" && (
          <TabContent wide>
            <ModelSettingsTab
              agent={agent}
              runtimes={runtimes}
              canEdit={canEdit}
              onUpdate={onUpdate}
            />
          </TabContent>
        )}
        {activeTab === "runtime" && (
          <TabContent wide>
            <RuntimeSettingsTab
              agent={agent}
              runtimes={runtimes}
              members={members}
              currentUserId={currentUserId}
              canEdit={canEdit}
              onUpdate={onUpdate}
            />
          </TabContent>
        )}
        {activeTab === "instructions" && (
          <TabContent wide fill>
            <SingleConfigPanel
              title="指令"
              description="定义智能体的身份、工作方式和约束，会在每次任务执行前注入上下文。"
              fill
            >
              <InstructionsTab
                agent={agent}
                onSave={(instructions) =>
                  onUpdate(agent.id, { instructions })
                }
                onDirtyChange={setActiveDirty}
              />
            </SingleConfigPanel>
          </TabContent>
        )}
        {activeTab === "skills" && (
          <TabContent wide>
            <SingleConfigPanel
              title="技能"
              description="把可复用的工作区技能绑定给这个智能体；本地运行环境技能仍由 runtime 自动提供。"
            >
              <SkillsTab agent={agent} />
            </SingleConfigPanel>
          </TabContent>
        )}
        {activeTab === "memory" && (
          <TabContent wide>
            <AgentMemoryTab agent={agent} />
          </TabContent>
        )}
        {activeTab === "context" && (
          <TabContent wide>
            <ProjectContextTab agent={agent} />
          </TabContent>
        )}
        {activeTab === "env" && (
          <TabContent wide>
            <SingleConfigPanel
              title="环境变量"
              description="敏感值会作为运行时环境注入，适合放 API Key、Base URL 和项目私有开关。"
            >
              <EnvTab
                agent={agent}
                readOnly={agent.custom_env_redacted}
                onSave={(updates) => onUpdate(agent.id, updates)}
                onDirtyChange={setActiveDirty}
              />
            </SingleConfigPanel>
          </TabContent>
        )}
        {activeTab === "custom_args" && (
          <TabContent wide>
            <SingleConfigPanel
              title="自定义参数"
              description="高级 CLI 参数会追加到启动命令尾部。这里应只放无法被页面字段表达的参数。"
            >
              {hasModelCliOverride(agent.custom_args) && (
                <ModelConflictWarning className="mb-3" />
              )}
              <CustomArgsTab
                agent={agent}
                runtimeDevice={runtime ?? undefined}
                onSave={(updates) => onUpdate(agent.id, updates)}
                onDirtyChange={setActiveDirty}
              />
            </SingleConfigPanel>
          </TabContent>
        )}
      </div>

      {pendingTab !== null && (
        <AlertDialog
          open
          onOpenChange={(v) => {
            if (!v) setPendingTab(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
              <AlertDialogDescription>
                这个标签页里还有未保存的修改。现在离开会丢弃它们。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>继续编辑</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={commitTabChange}
              >
                放弃修改
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

// Centred, max-width container shared by every config tab. `h-full flex
// flex-col` lets a tab opt into "fill the viewport" by giving its root
// element `flex-1 min-h-0` (Instructions does this so the editor expands
// instead of pushing the Save row off-screen). Tabs that don't opt in
// behave as natural-height blocks; long content (e.g. Settings, long Skills
// list) still scrolls via the parent's overflow-y-auto.
function TabContent({
  children,
  wide = false,
  fill = false,
}: {
  children: ReactNode;
  wide?: boolean;
  fill?: boolean;
}) {
  return (
    <div
      className={`mx-auto flex h-full w-full flex-col p-6 ${
        wide ? "max-w-6xl" : "max-w-4xl"
      } ${fill ? "min-h-0" : ""}`}
    >
      {children}
    </div>
  );
}

function SingleConfigPanel({
  title,
  description,
  children,
  fill = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  fill?: boolean;
}) {
  return (
    <section className={`flex flex-col gap-3 ${fill ? "min-h-0 flex-1" : ""}`}>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div
        className={`rounded-lg border bg-card p-4 ${
          fill ? "min-h-0 flex-1" : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}

function OverviewTab({
  agent,
  runtimes,
}: {
  agent: Agent;
  runtimes: AgentRuntime[];
}) {
  const runtime = agent.runtime_id
    ? runtimes.find((r) => r.id === agent.runtime_id) ?? null
    : null;
  const dedicatedModel = agent.model.trim().length > 0;
  const envCount = Object.keys(agent.custom_env ?? {}).length;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">智能体运转总览</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            一个智能体由模型、运行环境、指令、技能、记忆、上下文、环境变量、自定义参数和工作记录共同构成。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <OverviewCard
            title="模型"
            body={
              dedicatedModel
                ? `当前专属模型：${agent.model}`
                : "当前继承运行环境默认模型"
            }
            meta={dedicatedModel ? "当前智能体专属配置" : "继承默认"}
          />
          <OverviewCard
            title="运行环境"
            body={runtime?.name ?? "未选择运行环境"}
            meta={runtime?.name ?? "未选择运行环境"}
          />
          <OverviewCard
            title="指令"
            body={
              agent.instructions
                ? "已配置角色指令"
                : "尚未配置角色指令"
            }
            meta="任务执行前注入上下文"
          />
          <OverviewCard
            title="技能"
            body={`${agent.skills.length} 个绑定技能`}
            meta={`${agent.skills.length} 个绑定技能`}
          />
          <OverviewCard
            title="记忆"
            body="智能体记忆承接长期经验。"
            meta="候选记忆需确认后生效"
          />
          <OverviewCard
            title="上下文"
            body="项目上下文承接具体项目资料。"
            meta="按项目隔离资料和口径"
          />
          <OverviewCard
            title="环境变量"
            body={`${envCount} 个环境变量`}
            meta="仅放运行时必需敏感配置"
          />
          <OverviewCard
            title="自定义参数"
            body={`${agent.custom_args.length} 个参数`}
            meta="仅放页面字段无法表达的参数"
          />
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">最近动态</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              失败、执行中和最近完成的任务会优先出现在这里。
            </p>
          </div>
          <Badge variant="outline">{agent.status}</Badge>
        </div>
        <ActivityTab agent={agent} />
      </section>
    </div>
  );
}

function OverviewCard({
  title,
  body,
  meta,
}: {
  title: string;
  body: string;
  meta: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <p className="mt-3 truncate text-xs text-muted-foreground/80">{meta}</p>
    </div>
  );
}
