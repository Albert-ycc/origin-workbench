// Runtime capability classification — derives what an agent can actually
// *do* from its bound runtime. Mirrors the mental model in the runtimes
// table: a cloud/API runtime can only respond to chat prompts (api_readonly);
// a local runtime with a daemon can execute shell/tools (local_execute);
// an offline or missing runtime provides nothing (unavailable).

import type { Agent, AgentRuntime } from "../types";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export type RuntimeCapabilityKind = "api_readonly" | "local_execute" | "unavailable";

// ---------------------------------------------------------------------------
// Copy & badge style (uses existing tailwind semantic token palette)
// ---------------------------------------------------------------------------

interface RuntimeCapabilityEntry {
  label: string;
  description: string;
  /** Tailwind classes for the badge — no raw hex values. */
  badgeClassName: string;
}

export const runtimeCapabilityCopy: Record<RuntimeCapabilityKind, RuntimeCapabilityEntry> = {
  api_readonly: {
    label: "仅对话",
    description: "云端 API 运行时，只能接收聊天消息，不能执行本地命令或工具",
    badgeClassName: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  },
  local_execute: {
    label: "本地执行",
    description: "本地 daemon 运行时，可执行 shell 命令、读写文件和调用工具",
    badgeClassName: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  },
  unavailable: {
    label: "不可用",
    description: "运行时已离线或未绑定，Agent 暂时无法响应任何任务",
    badgeClassName: "bg-muted text-muted-foreground border-border",
  },
};

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derive capability from a runtime record alone. Returns `unavailable` when
 * the runtime is missing entirely (null/undefined) — callers that don't have
 * a runtime at all should pass null.
 */
export function deriveRuntimeCapability(runtime: AgentRuntime | null | undefined): RuntimeCapabilityKind {
  if (!runtime || runtime.status !== "online") return "unavailable";
  // API/cloud runtimes cannot execute tools locally, only respond to chat.
  if (runtime.runtime_mode === "cloud") return "api_readonly";
  return "local_execute";
}

/**
 * Derive an agent's capability considering both the agent record and its
 * bound runtime. An archived agent is always unavailable regardless of
 * runtime health.
 */
export function deriveAgentRuntimeCapability(
  agent: Pick<Agent, "archived_at" | "runtime_mode" | "runtime_config">,
  runtime: AgentRuntime | null | undefined,
): RuntimeCapabilityKind {
  if (agent.archived_at) return "unavailable";
  if (!runtime || runtime.status !== "online") return "unavailable";
  if (runtime.runtime_mode === "cloud") return "api_readonly";
  return "local_execute";
}
