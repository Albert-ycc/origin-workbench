"use client";

/**
 * agent 人格抽屉 — 点击 agent 头像或名字后从右侧滑出
 *
 * 四段内容：
 *   1. 人设卡（名字 + 一句话描述 + 头像 + 兴趣标签）
 *   2. 她的记忆（按时间倒序，可删/可钉 stub）
 *   3. 她和谁亲近（关系网 placeholder）
 *   4. 她最近读了什么（兴趣订阅 placeholder）
 *
 * 底部危险区：让她去旅行（隐藏）+ 永远告别（删除，二次确认）
 *
 * 注意：外层 div 用 position:fixed/absolute，不参与 flex layout，
 * 防止 overlay 被父容器重排到外部裁掉（feedback_figma_modal_pattern.md 同款规则）
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Pin, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import type { Agent } from "@multica/core/types";
import { agentMemoriesOptions } from "@multica/core/agents";
import { api } from "@multica/core/api";
import { workspaceKeys } from "@multica/core/workspace/queries";
import { ActorAvatar } from "../../common/actor-avatar";

interface AgentPersonalityDrawerProps {
  agent: Agent;
  wsId: string | undefined;
  onClose: () => void;
}

export function AgentPersonalityDrawer({
  agent,
  wsId,
  onClose,
}: AgentPersonalityDrawerProps) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [memoriesOpen, setMemoriesOpen] = useState(true);

  const { data: memoriesResp, isLoading: memoriesLoading } = useQuery({
    ...agentMemoriesOptions(wsId ?? "", agent.id),
    enabled: !!wsId,
  });
  const memories = memoriesResp?.memories ?? [];

  const handleArchive = async () => {
    if (!wsId) return;
    setDeleting(true);
    try {
      await api.archiveAgent(agent.id);
      qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      onClose();
    } catch {
      // ignore, agent will stay
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // 兴趣标签从 agent description 中提取（简单 comma split）
  const tags = agent.description
    ? agent.description.split(/[,，、]/).map((t) => t.trim()).filter(Boolean).slice(0, 5)
    : [];

  return (
    // 外层：绝对定位 overlay，不参与 flex layout
    <div
      className="absolute inset-0 z-50 flex"
      style={{ pointerEvents: "auto" }}
      onClick={(e) => {
        // 点击背景关闭
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 半透明遮罩 */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.08)" }}
        onClick={onClose}
      />
      {/* 抽屉主体 — 右侧 60%，绝对定位 */}
      <div
        className="absolute right-0 top-0 bottom-0 flex flex-col overflow-hidden shadow-xl"
        style={{
          width: "60%",
          background: "#FFFFFF",
          borderLeft: "1px solid #E8E8E8",
          animation: "living-drawer-in 0.2s cubic-bezier(0.4, 0.0, 0.2, 1)",
        }}
      >
        {/* 抽屉头部 */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#E8E8E8", flexShrink: 0 }}
        >
          <span
            className="text-sm font-semibold"
            style={{ color: "#1F2329" }}
          >
            {agent.name}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
            aria-label="关闭"
          >
            <X className="size-4" style={{ color: "#86909C" }} />
          </button>
        </div>

        {/* 可滚动内容区 */}
        <div className="flex-1 overflow-y-auto">
          {/* ── 第1段：人设卡 ── */}
          <DrawerSection title="人设卡">
            <div className="flex items-start gap-4">
              {/* 圆形头像 */}
              <div className="shrink-0">
                <ActorAvatar
                  actorType="agent"
                  actorId={agent.id}
                  size={52}
                  showStatusDot
                />
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className="text-base font-semibold mb-1"
                  style={{ color: "#1F2329" }}
                >
                  {agent.name}
                </div>
                {agent.description ? (
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "#86909C" }}
                  >
                    {agent.description}
                  </p>
                ) : (
                  <p
                    className="text-sm italic"
                    style={{ color: "#C0C4CC" }}
                  >
                    还没有自我介绍
                  </p>
                )}
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[11px] px-2 py-0.5 rounded-full"
                        style={{
                          background: "#F0F5FF",
                          color: "#1677FF",
                          border: "1px solid rgba(22,119,255,0.15)",
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </DrawerSection>

          {/* ── 第2段：她的记忆 ── */}
          <DrawerSection
            title="她的记忆"
            action={
              <button
                type="button"
                onClick={() => setMemoriesOpen(!memoriesOpen)}
                className="p-0.5 rounded hover:bg-gray-100 transition-colors"
                aria-label={memoriesOpen ? "收起" : "展开"}
              >
                {memoriesOpen
                  ? <ChevronUp className="size-3.5" style={{ color: "#86909C" }} />
                  : <ChevronDown className="size-3.5" style={{ color: "#86909C" }} />
                }
              </button>
            }
          >
            {memoriesOpen && (
              <>
                {memoriesLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : memories.length === 0 ? (
                  <p className="text-sm italic" style={{ color: "#C0C4CC" }}>
                    她还没有沉淀任何记忆
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {memories.slice(0, 10).map((mem) => (
                      <div
                        key={mem.id}
                        className="group flex items-start gap-2 p-2 rounded-lg border text-sm"
                        style={{
                          borderColor: "#E8E8E8",
                          background: "#FAFAFA",
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div
                            className="font-medium text-xs truncate"
                            style={{ color: "#1F2329" }}
                          >
                            {mem.title}
                          </div>
                          {mem.body && (
                            <div
                              className="text-xs mt-0.5 line-clamp-2"
                              style={{ color: "#86909C" }}
                            >
                              {mem.body}
                            </div>
                          )}
                        </div>
                        {/* stub 操作按钮：钉/删，v1.0.14 接后端 */}
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-blue-50 transition-colors"
                            title="钉住这段记忆"
                            onClick={() => { /* stub: v1.0.14 */ }}
                          >
                            <Pin className="size-3" style={{ color: "#86909C" }} />
                          </button>
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-red-50 transition-colors"
                            title="删除这段记忆"
                            onClick={() => { /* stub: v1.0.14 */ }}
                          >
                            <Trash2 className="size-3" style={{ color: "#86909C" }} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </DrawerSection>

          {/* ── 第3段：她和谁亲近 ── */}
          <DrawerSection title="她和谁亲近">
            <p className="text-sm italic" style={{ color: "#C0C4CC" }}>
              还没有亲近的朋友
            </p>
          </DrawerSection>

          {/* ── 第4段：她最近读了什么 ── */}
          <DrawerSection title="她最近读了什么">
            <p className="text-sm italic" style={{ color: "#C0C4CC" }}>
              她还没有特别在读的东西
            </p>
          </DrawerSection>
        </div>

        {/* 底部危险区 */}
        <div
          className="px-5 py-4 border-t"
          style={{ borderColor: "#E8E8E8", flexShrink: 0 }}
        >
          {!confirmDelete ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-md border transition-colors hover:bg-gray-50"
                style={{ color: "#86909C", borderColor: "#E8E8E8" }}
                onClick={() => { /* stub: 隐藏 agent，v1.0.14 */ }}
              >
                让她去旅行
              </button>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-md border transition-colors hover:bg-red-50"
                style={{ color: "#FF4D4F", borderColor: "rgba(255,77,79,0.3)" }}
                onClick={() => setConfirmDelete(true)}
              >
                永远告别
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p
                className="text-xs"
                style={{ color: "#86909C" }}
              >
                你确定要和 {agent.name} 永远告别吗？她会被归档，无法再聊天。
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleting}
                  onClick={handleArchive}
                  className="text-xs h-7"
                >
                  {deleting ? "归档中…" : "确认告别"}
                </Button>
                <button
                  type="button"
                  className="text-xs px-3 py-1 rounded-md hover:bg-gray-100 transition-colors"
                  style={{ color: "#86909C" }}
                  onClick={() => setConfirmDelete(false)}
                >
                  再想想
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 通用抽屉 section 容器
function DrawerSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="px-5 py-4 border-b"
      style={{ borderColor: "#F5F5F5" }}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "#86909C" }}
        >
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}
