"use client";

import { useQuery } from "@tanstack/react-query";
import { roomMembersOptions, useRemoveRoomMember } from "@multica/core/rooms";
import { useWorkspaceId } from "@multica/core/hooks";
import { agentListOptions } from "@multica/core/workspace/queries";
import { ActorAvatar } from "@multica/views/common/actor-avatar";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { Trash2, Users } from "lucide-react";
import { toast } from "sonner";

interface RoomMemberSidebarProps {
  roomId: string;
  onAddMember?: () => void;
}

export function RoomMemberSidebar({ roomId, onAddMember }: RoomMemberSidebarProps) {
  const wsId = useWorkspaceId();
  const { data, isPending } = useQuery(roomMembersOptions(roomId));
  const { data: agents = [] } = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId,
  });
  const removeMember = useRemoveRoomMember(roomId);
  const members = data?.members ?? [];
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  const handleRemoveAgent = async (agentId: string, name: string) => {
    try {
      await removeMember.mutateAsync(agentId);
      toast.success(`已移除「${name}」`);
    } catch {
      toast.error("移除成员失败");
    }
  };

  return (
    <div
      className="flex flex-col w-[200px] shrink-0 border-r h-full overflow-y-auto"
      style={{ borderColor: "var(--living-border-line, #E8E8E8)" }}
    >
      <div
        className="flex items-center justify-between px-3 py-3 border-b"
        style={{ borderColor: "var(--living-border-line, #E8E8E8)" }}
      >
        <div className="flex items-center gap-1.5">
          <Users className="size-3.5" style={{ color: "var(--living-text-secondary, #86909C)" }} />
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--living-text-secondary, #86909C)" }}
          >
            成员
          </span>
        </div>
        {onAddMember && (
          <Button variant="ghost" size="xs" onClick={onAddMember}>
            + 邀请
          </Button>
        )}
      </div>

      <div className="flex-1 py-2 space-y-0.5 px-2">
        {isPending ? (
          <>
            <MemberRowSkeleton />
            <MemberRowSkeleton />
            <MemberRowSkeleton />
          </>
        ) : members.length === 0 ? (
          <p
            className="text-xs italic px-2 py-2"
            style={{ color: "var(--living-text-secondary, #86909C)" }}
          >
            还没有成员
          </p>
        ) : (
          members.map((member) => {
            const agentId = member.agent_id ?? member.member_id;
            const agent = member.member_type === "agent" ? agentById.get(agentId) : undefined;
            return (
              <div key={member.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors cursor-default">
                <ActorAvatar
                  actorType="agent"
                  actorId={agentId}
                  size={24}
                  showStatusDot
                />
                <span
                  className="text-xs truncate flex-1"
                  style={{ color: "var(--living-text-primary, #1F2329)" }}
                  title={agent?.name ?? agentId}
                >
                  {agent?.name ?? agentId}
                </span>
                {member.member_type === "agent" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`移除${agent?.name ?? agentId}`}
                    disabled={removeMember.isPending}
                    onClick={() => void handleRemoveAgent(agentId, agent?.name ?? agentId)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Skeleton className="size-6 rounded-full shrink-0" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}
