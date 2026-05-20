"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { useCreateRoom } from "@multica/core/rooms";
import { useCurrentWorkspace } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import { ActorAvatar } from "@multica/views/common/actor-avatar";
import type { Agent } from "@multica/core/types";

interface CreateRoomModalProps {
  onClose: () => void;
  onCreated?: (roomId: string) => void;
}

export function CreateRoomModal({ onClose, onCreated }: CreateRoomModalProps) {
  const workspace = useCurrentWorkspace();
  const wsId = workspace?.id ?? "";
  const createRoom = useCreateRoom();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  const agentQuery = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId,
  });
  const agents: Agent[] = (agentQuery.data ?? []).filter((a) => !a.archived_at);

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    );
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    createRoom.mutate(
      { name: name.trim(), description: description.trim() || undefined, agent_ids: selectedAgentIds },
      {
        onSuccess: (room) => {
          onCreated?.(room.id);
          onClose();
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.12)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-[440px] rounded-2xl shadow-xl flex flex-col"
        style={{ background: "#FFFFFF", border: "1px solid #E8E8E8", maxHeight: "80vh" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "#E8E8E8", flexShrink: 0 }}
        >
          <span className="text-sm font-semibold" style={{ color: "#1F2329" }}>
            新建客厅
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
          >
            <X className="size-4" style={{ color: "#86909C" }} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: "#1F2329" }}>
              客厅名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="给这个客厅起个名字"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:border-[#1677FF] focus:shadow-[0_0_0_2px_rgba(22,119,255,0.1)]"
              style={{ borderColor: "#E8E8E8", color: "#1F2329" }}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: "#1F2329" }}>
              描述 <span style={{ color: "#C0C4CC", fontWeight: 400 }}>（可选）</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个客厅聊什么？"
              rows={2}
              className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:border-[#1677FF] focus:shadow-[0_0_0_2px_rgba(22,119,255,0.1)]"
              style={{ borderColor: "#E8E8E8", color: "#1F2329" }}
            />
          </div>

          {agents.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium" style={{ color: "#1F2329" }}>
                邀请谁进来
              </label>
              <div className="grid grid-cols-2 gap-2">
                {agents.map((agent) => {
                  const selected = selectedAgentIds.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => toggleAgent(agent.id)}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all"
                      style={{
                        borderColor: selected ? "#1677FF" : "#E8E8E8",
                        background: selected ? "#F0F5FF" : "#FFFFFF",
                      }}
                    >
                      <ActorAvatar actorType="agent" actorId={agent.id} size={24} />
                      <span
                        className="text-xs truncate flex-1"
                        style={{ color: "#1F2329" }}
                      >
                        {agent.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t flex items-center justify-end gap-2"
          style={{ borderColor: "#E8E8E8", flexShrink: 0 }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-1.5 rounded-lg border transition-colors hover:bg-gray-50"
            style={{ color: "#86909C", borderColor: "#E8E8E8" }}
          >
            取消
          </button>
          <Button
            disabled={!name.trim() || createRoom.isPending}
            onClick={handleCreate}
            className="text-sm h-8"
          >
            {createRoom.isPending ? "创建中…" : "创建客厅"}
          </Button>
        </div>
      </div>
    </div>
  );
}
