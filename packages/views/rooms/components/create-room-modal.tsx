"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { useCreateRoom } from "@multica/core/rooms";
import { useCurrentWorkspace } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import { ActorAvatar } from "@multica/views/common/actor-avatar";
import type { Agent } from "@multica/core/types";
import { pickRandomTeaRoomCoverTheme } from "../room-covers";

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
      {
        name: name.trim(),
        description: description.trim() || undefined,
        theme: pickRandomTeaRoomCoverTheme(),
        agent_ids: selectedAgentIds,
      },
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
        className="relative w-[440px] rounded-lg border bg-card shadow-xl flex flex-col"
        style={{ maxHeight: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <span className="text-sm font-semibold">
            新建茶水间
          </span>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              茶水间名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="给这个茶水间起个名字"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:border-ring focus:ring-2 focus:ring-ring/20"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              描述 <span className="text-muted-foreground font-normal">（可选）</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个茶水间聊什么？"
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {agents.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">
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
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-left transition-all text-sm",
                        selected
                          ? "border-ring bg-muted"
                          : "border-border bg-background hover:bg-muted",
                      )}
                    >
                      <ActorAvatar actorType="agent" actorId={agent.id} size={24} />
                      <span className="text-xs truncate flex-1 text-foreground">
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
        <div className="px-6 py-4 border-t flex items-center justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!name.trim() || createRoom.isPending}
            onClick={handleCreate}
          >
            {createRoom.isPending ? "创建中…" : "创建茶水间"}
          </Button>
        </div>
      </div>
    </div>
  );
}
