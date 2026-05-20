"use client";

import { useQuery } from "@tanstack/react-query";
import { roomMembersOptions } from "@multica/core/rooms";
import { ActorAvatar } from "@multica/views/common/actor-avatar";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { Users } from "lucide-react";

interface RoomMemberSidebarProps {
  roomId: string;
  onAddMember?: () => void;
}

export function RoomMemberSidebar({ roomId, onAddMember }: RoomMemberSidebarProps) {
  const { data, isPending } = useQuery(roomMembersOptions(roomId));
  const members = data?.members ?? [];

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
          members.map((member) => (
            <div key={member.agent_id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors cursor-default">
              <ActorAvatar
                actorType="agent"
                actorId={member.agent_id}
                size={24}
                showStatusDot
              />
              <span
                className="text-xs truncate flex-1"
                style={{ color: "var(--living-text-primary, #1F2329)" }}
              >
                {member.agent_id}
              </span>
            </div>
          ))
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
