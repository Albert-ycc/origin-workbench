"use client";

import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@multica/ui/lib/utils";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { ChevronRight, ChevronDown, Brain, AlertCircle, AlertTriangle } from "lucide-react";
import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";
import { useAutoScroll } from "@multica/ui/hooks/use-auto-scroll";
import { taskMessagesOptions } from "@multica/core/chat/queries";
import { Markdown } from "@multica/views/common/markdown";
import type { AgentAvailability } from "@multica/core/agents";
import type { Agent, ChatMessage, ChatPendingTask, TaskMessagePayload, TaskFailureReason } from "@multica/core/types";
import type { ChatTimelineItem } from "@multica/core/chat";
import { failureReasonLabel } from "../../agents/components/tabs/task-failure";
import { TaskStatusPill } from "./task-status-pill";
import { formatElapsedMs } from "../lib/format";
import { ActorAvatar } from "../../common/actor-avatar";

// ─── Public component ────────────────────────────────────────────────────

interface ChatMessageListProps {
  messages: ChatMessage[];
  /**
   * Server-authoritative pending-task snapshot. `null` / undefined means
   * no in-flight task — list renders without StatusPill.
   */
  pendingTask: ChatPendingTask | null | undefined;
  /** Resolved presence; pass `undefined` while loading to keep the pill copy neutral. */
  availability: AgentAvailability | undefined;
  /** Active agent — drives avatar + name display in assistant bubbles. */
  agent?: Agent | null;
  /** Callback when user clicks agent avatar/name to open personality drawer. */
  onOpenAgentDrawer?: (agentId: string) => void;
}

export function ChatMessageList({
  messages,
  pendingTask,
  availability,
  agent,
  onOpenAgentDrawer,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeStyle = useScrollFade(scrollRef);
  useAutoScroll(scrollRef);

  const pendingTaskId = pendingTask?.task_id ?? null;

  const pendingAlreadyPersisted = !!pendingTaskId && messages.some(
    (m) => m.role === "assistant" && m.task_id === pendingTaskId,
  );

  const showLiveTimeline = !!pendingTaskId && !pendingAlreadyPersisted;
  const { data: liveTaskMessages } = useQuery({
    ...taskMessagesOptions(pendingTaskId ?? ""),
    enabled: showLiveTimeline,
  });
  const liveTimeline: ChatTimelineItem[] = (liveTaskMessages ?? []).map(toTimelineItem);
  const hasLive = showLiveTimeline && liveTimeline.length > 0;
  const showStatusPill = !!pendingTaskId && !pendingAlreadyPersisted && !!pendingTask;

  // 连续同一人消息合并气泡组：记录上一条消息的 role，避免重复显示头像名字
  let prevRole: string | null = null;

  return (
    <div ref={scrollRef} style={fadeStyle} className="flex-1 overflow-y-auto bg-white">
      <div className="mx-auto w-full max-w-4xl px-5 py-4 space-y-1">
        {messages.map((msg) => {
          const isMerged = msg.role === prevRole;
          prevRole = msg.role;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              agent={agent}
              isMerged={isMerged}
              onOpenAgentDrawer={onOpenAgentDrawer}
            />
          );
        })}
        {hasLive && (
          <div className="w-full space-y-1.5 pt-2">
            {agent && (
              <AgentNameRow agent={agent} onOpenDrawer={onOpenAgentDrawer} />
            )}
            <TimelineView items={liveTimeline} />
            {/* typing shimmer */}
            <TypingShimmer agentName={agent?.name} />
          </div>
        )}
        {showStatusPill && pendingTask && (
          <TaskStatusPill
            pendingTask={pendingTask}
            taskMessages={liveTaskMessages ?? []}
            availability={availability}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Placeholder shown while messages are being fetched.
 */
export function ChatMessageSkeleton() {
  return (
    <div className="flex-1 overflow-hidden bg-white">
      <div className="mx-auto w-full max-w-4xl px-5 py-4 space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-8 w-48 rounded-2xl" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-5/6" />
          <Skeleton className="h-3.5 w-1/3" />
        </div>
      </div>
    </div>
  );
}

function toTimelineItem(m: TaskMessagePayload): ChatTimelineItem {
  return {
    seq: m.seq,
    type: m.type,
    tool: m.tool,
    content: m.content,
    input: m.input,
    output: m.output,
  };
}

// ─── Agent name/avatar row ────────────────────────────────────────────────

function AgentNameRow({
  agent,
  isAutonomous,
  onOpenDrawer,
}: {
  agent: Agent;
  isAutonomous?: boolean;
  onOpenDrawer?: (agentId: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      {/* 圆形头像 + 心境 dot */}
      <button
        type="button"
        onClick={() => onOpenDrawer?.(agent.id)}
        className="relative shrink-0 rounded-full focus:outline-none"
        aria-label={`查看 ${agent.name} 的人格`}
      >
        <ActorAvatar
          actorType="agent"
          actorId={agent.id}
          size={26}
          showStatusDot
          // showStatusDot 渲染的是 online/unstable/offline 三态
          // 客厅化心境 dot（active 绿/安静黄/离开灰）v1.0.14 接活感算法后替换
        />
      </button>
      <span
        className="text-[11.5px] font-medium cursor-pointer"
        style={{ color: "var(--living-text-secondary, #86909C)" }}
        onClick={() => onOpenDrawer?.(agent.id)}
      >
        {agent.name}
      </span>
      {isAutonomous && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{
            color: "var(--living-accent-orange, #F59E0B)",
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.2)",
          }}
        >
          · 自言自语
        </span>
      )}
    </div>
  );
}

// typing shimmer："{agentName} 正在想…"
function TypingShimmer({ agentName }: { agentName?: string }) {
  const label = agentName ? `${agentName} 正在想…` : "正在想…";
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs"
      style={{
        background: "#FFFFFF",
        borderColor: "var(--living-border-line, #E8E8E8)",
        color: "var(--living-text-secondary, #86909C)",
      }}
    >
      <span>{label}</span>
      <span
        className="inline-block h-0.5 w-12 rounded-full overflow-hidden"
        style={{ background: "#E8E8E8" }}
      >
        <span
          className="block h-full rounded-full"
          style={{
            background: "linear-gradient(90deg, #E8E8E8 0%, #C0C4CC 40%, #E8E8E8 100%)",
            backgroundSize: "200% 100%",
            animation: "living-shimmer 1.6s ease-in-out infinite",
          }}
        />
      </span>
    </div>
  );
}

// ─── Message bubbles ─────────────────────────────────────────────────────

function MessageBubble({
  message,
  agent,
  isMerged,
  onOpenAgentDrawer,
}: {
  message: ChatMessage;
  agent?: Agent | null;
  isMerged: boolean;
  onOpenAgentDrawer?: (agentId: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className={cn("flex justify-end", isMerged ? "mt-0.5" : "mt-3")}>
        <div
          className="rounded-lg px-3.5 py-2 text-sm max-w-[80%] break-words"
          style={{
            background: "#F0F5FF",
            border: "1px solid rgba(22,119,255,0.15)",
            borderRadius: "8px",
            color: "var(--living-text-primary, #1F2329)",
          }}
        >
          <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <Markdown>{message.content}</Markdown>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AssistantMessage
      message={message}
      agent={agent}
      isMerged={isMerged}
      onOpenAgentDrawer={onOpenAgentDrawer}
    />
  );
}

function AssistantMessage({
  message,
  agent,
  isMerged,
  onOpenAgentDrawer,
}: {
  message: ChatMessage;
  agent?: Agent | null;
  isMerged: boolean;
  onOpenAgentDrawer?: (agentId: string) => void;
}) {
  const taskId = message.task_id;

  const { data: taskMessages } = useQuery({
    ...taskMessagesOptions(taskId ?? ""),
    enabled: !!taskId,
  });

  const timeline: ChatTimelineItem[] = (taskMessages ?? []).map(toTimelineItem);

  // autonomous flag：从 message 读，后端 v1.0.14 补上后自然激活
  // 类型扩展：ChatMessage 暂无此字段，用 unknown 中转安全读取
  const isAutonomous = !!((message as unknown as Record<string, unknown>)["autonomous"]);

  if (message.failure_reason) {
    return (
      <FailureBubble
        reason={message.failure_reason}
        rawError={message.content}
        timeline={timeline}
        elapsedMs={message.elapsed_ms}
      />
    );
  }

  return (
    <div className={cn("w-full", isMerged ? "mt-0.5" : "mt-3")}>
      {/* 仅第一条消息显示 agent 名字行，连续消息合并 */}
      {!isMerged && agent && (
        <AgentNameRow
          agent={agent}
          isAutonomous={isAutonomous}
          onOpenDrawer={onOpenAgentDrawer}
        />
      )}
      {/* 消息气泡 */}
      <div
        className={cn(
          "relative rounded-lg border px-3.5 py-2 text-sm",
          isAutonomous && "autonomous-bubble",
        )}
        style={{
          background: "#FFFFFF",
          borderColor: "var(--living-border-line, #E8E8E8)",
          borderRadius: "8px",
          borderLeft: isAutonomous ? "4px solid #F59E0B" : undefined,
          color: "var(--living-text-primary, #1F2329)",
        }}
      >
        {timeline.length > 0 ? (
          <TimelineView items={timeline} />
        ) : (
          <div className="text-sm leading-relaxed prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <Markdown>{message.content}</Markdown>
          </div>
        )}
      </div>
      {/* 时间戳：hover 才显 */}
      {message.elapsed_ms != null && (
        <ElapsedCaption verb="回复耗时" elapsedMs={message.elapsed_ms} />
      )}
    </div>
  );
}

function ElapsedCaption({
  verb,
  elapsedMs,
  className,
}: {
  verb: string;
  elapsedMs: number;
  className?: string;
}) {
  return (
    <div
      className={cn("text-[11px] opacity-0 group-hover:opacity-100 transition-opacity", className)}
      style={{ color: "var(--living-text-secondary, #86909C)" }}
    >
      {verb} {formatElapsedMs(elapsedMs)}
    </div>
  );
}

function FailureBubble({
  reason,
  rawError,
  timeline,
  elapsedMs,
}: {
  reason: string;
  rawError: string;
  timeline: ChatTimelineItem[];
  elapsedMs?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const label =
    failureReasonLabel[reason as TaskFailureReason] ?? "任务失败";

  return (
    <div className="w-full space-y-1.5 mt-3">
      <div className="flex items-start gap-1.5 text-sm">
        <AlertTriangle className="size-3.5 shrink-0 text-destructive/80 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-destructive/90">{label}</div>
          {rawError.trim() && (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                {open ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                <span>显示详情</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/40 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
                  {rawError}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </div>
      {timeline.length > 0 && <TimelineView items={timeline} />}
      {elapsedMs != null && (
        <ElapsedCaption verb="失败耗时" elapsedMs={elapsedMs} />
      )}
    </div>
  );
}

// ─── Timeline: flat interleaved text + collapsible tool groups ───────────

interface TimelineSegment {
  kind: "text" | "tools";
  items: ChatTimelineItem[];
}

function segmentTimeline(items: ChatTimelineItem[]): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  let toolBuf: ChatTimelineItem[] = [];
  let textBuf: ChatTimelineItem[] = [];

  const flushTools = () => {
    if (toolBuf.length > 0) {
      segments.push({ kind: "tools", items: toolBuf });
      toolBuf = [];
    }
  };

  const flushText = () => {
    if (textBuf.length > 0) {
      segments.push({ kind: "text", items: textBuf });
      textBuf = [];
    }
  };

  for (const item of items) {
    if (item.type === "text") {
      flushTools();
      textBuf.push(item);
    } else {
      flushText();
      toolBuf.push(item);
    }
  }
  flushText();
  flushTools();
  return segments;
}

function TimelineView({ items }: { items: ChatTimelineItem[] }) {
  const segments = segmentTimeline(items);

  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <div key={seg.items[0]!.seq} className="text-sm leading-relaxed prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <Markdown>{seg.items.map((t) => t.content ?? "").join("")}</Markdown>
          </div>
        ) : (
          <ToolGroupCollapsible
            key={seg.items[0]!.seq}
            items={seg.items}
            defaultOpen={i === segments.length - 1}
          />
        ),
      )}
    </>
  );
}

function ToolGroupCollapsible({
  items,
  defaultOpen,
}: {
  items: ChatTimelineItem[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const toolCount = items.filter((i) => i.type === "tool_use").length;
  const label = `${toolCount} 个工具`;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span>{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded-lg border bg-muted/20 p-2 space-y-0.5">
          {items.map((item) => (
            <ItemRow key={item.seq} item={item} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Individual item rows ────────────────────────────────────────────────

function ItemRow({ item }: { item: ChatTimelineItem }) {
  switch (item.type) {
    case "tool_use":
      return <ToolCallRow item={item} />;
    case "tool_result":
      return <ToolResultRow item={item} />;
    case "thinking":
      return <ThinkingRow item={item} />;
    case "error":
      return <ErrorRow item={item} />;
    default:
      return null;
  }
}

function shortenPath(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return ".../" + parts.slice(-2).join("/");
}

function getToolSummary(item: ChatTimelineItem): string {
  if (!item.input) return "";
  const inp = item.input as Record<string, string>;
  if (inp.query) return inp.query;
  if (inp.file_path) return shortenPath(inp.file_path);
  if (inp.path) return shortenPath(inp.path);
  if (inp.pattern) return inp.pattern;
  if (inp.description) return String(inp.description);
  if (inp.command) {
    const cmd = String(inp.command);
    return cmd.length > 100 ? cmd.slice(0, 100) + "..." : cmd;
  }
  if (inp.prompt) {
    const p = String(inp.prompt);
    return p.length > 100 ? p.slice(0, 100) + "..." : p;
  }
  if (inp.skill) return String(inp.skill);
  for (const v of Object.values(inp)) {
    if (typeof v === "string" && v.length > 0 && v.length < 120) return v;
  }
  return "";
}

function ToolCallRow({ item }: { item: ChatTimelineItem }) {
  const [open, setOpen] = useState(false);
  const summary = getToolSummary(item);
  const hasInput = item.input && Object.keys(item.input).length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded px-1 -mx-1 py-0.5 text-xs hover:bg-accent/30 transition-colors">
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
            !hasInput && "invisible",
          )}
        />
        <span className="font-medium text-foreground shrink-0">{item.tool}</span>
        {summary && <span className="truncate text-muted-foreground">{summary}</span>}
      </CollapsibleTrigger>
      {hasInput && (
        <CollapsibleContent>
          <pre className="ml-[18px] mt-0.5 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
            {JSON.stringify(item.input, null, 2)}
          </pre>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function ToolResultRow({ item }: { item: ChatTimelineItem }) {
  const [open, setOpen] = useState(false);
  const output = item.output ?? "";
  if (!output) return null;

  const preview = output.length > 120 ? output.slice(0, 120) + "..." : output;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-start gap-1.5 rounded px-1 -mx-1 py-0.5 text-xs hover:bg-accent/30 transition-colors">
        <ChevronRight
          className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform mt-0.5", open && "rotate-90")}
        />
        <span className="text-muted-foreground/70 truncate">
          {item.tool ? `${item.tool} 结果：` : "结果："}{preview}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="ml-[18px] mt-0.5 max-h-40 overflow-auto rounded bg-muted/50 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
          {output.length > 4000 ? output.slice(0, 4000) + "\n...（已截断）" : output}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ThinkingRow({ item }: { item: ChatTimelineItem }) {
  const [open, setOpen] = useState(false);
  const text = item.content ?? "";
  if (!text) return null;

  const preview = text.length > 150 ? text.slice(0, 150) + "..." : text;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-start gap-1.5 rounded px-1 -mx-1 py-0.5 text-xs hover:bg-accent/30 transition-colors">
        <Brain className="h-3 w-3 shrink-0 text-muted-foreground/60 mt-0.5" />
        <span className="text-muted-foreground italic truncate">{preview}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="ml-[18px] mt-0.5 max-h-40 overflow-auto rounded bg-muted/30 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
          {text}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ErrorRow({ item }: { item: ChatTimelineItem }) {
  return (
    <div className="flex items-start gap-1.5 px-1 -mx-1 py-0.5 text-xs">
      <AlertCircle className="h-3 w-3 shrink-0 text-destructive mt-0.5" />
      <span className="text-destructive">{item.content}</span>
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────
