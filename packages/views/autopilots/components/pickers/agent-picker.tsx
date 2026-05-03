"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { agentListOptions } from "@multica/core/workspace/queries";
import { ActorAvatar } from "../../../common/actor-avatar";
import {
  AvatarNamePickerEmpty,
  AvatarNamePickerItem,
} from "../../../common/actor-picker/avatar-name-picker";
import {
  PropertyPicker,
} from "../../../issues/components/pickers/property-picker";

export function AgentPicker({
  agentId,
  onChange,
  trigger: customTrigger,
  triggerRender,
  align = "start",
}: {
  agentId: string | null;
  onChange: (id: string) => void;
  trigger?: React.ReactNode;
  triggerRender?: React.ReactElement;
  align?: "start" | "center" | "end";
}) {
  const wsId = useWorkspaceId();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const active = agents.filter((a) => !a.archived_at);
  const selected = active.find((a) => a.id === agentId);

  const query = filter.trim().toLowerCase();
  const filteredAgents = query
    ? active.filter((a) => a.name.toLowerCase().includes(query))
    : active;

  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      width="w-56"
      align={align}
      searchable
      searchPlaceholder="筛选智能体..."
      onSearchChange={setFilter}
      triggerRender={triggerRender}
      trigger={
        customTrigger ?? (
          <>
            {selected ? (
              <>
                <ActorAvatar actorType="agent" actorId={selected.id} size={16} showStatusDot />
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              <>
                <Bot className="size-3" />
                <span>选择智能体</span>
              </>
            )}
          </>
        )
      }
    >
      {filteredAgents.length === 0 ? (
        <AvatarNamePickerEmpty />
      ) : (
        filteredAgents.map((a) => (
          <AvatarNamePickerItem
            key={a.id}
            actorType="agent"
            actorId={a.id}
            label={a.name}
            description={a.description}
            selected={a.id === agentId}
            onSelect={() => {
              onChange(a.id);
              setOpen(false);
            }}
          />
        ))
      )}
    </PropertyPicker>
  );
}
