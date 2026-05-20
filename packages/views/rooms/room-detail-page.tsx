"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { roomOptions, useRoomsStore } from "@multica/core/rooms";
import { DragStrip } from "../platform";
import { RoomMemberSidebar } from "./components/room-member-sidebar";
import { RoomMessageList } from "./components/room-message-list";
import { RoomMessageInput } from "./components/room-message-input";
import { ChevronLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useWorkspacePaths } from "@multica/core/paths";
import { AppLink } from "../navigation";
import { Button } from "@multica/ui/components/ui/button";

interface RoomDetailPageProps {
  roomId?: string;
}

export function RoomDetailPage({ roomId }: RoomDetailPageProps) {
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const memberSidebarOpen = useRoomsStore((s) => s.memberSidebarOpen);
  const setMemberSidebarOpen = useRoomsStore((s) => s.setMemberSidebarOpen);

  const id = roomId;
  const { data: room, isPending } = useQuery(roomOptions(wsId, id ?? ""));

  if (!id) return null;

  return (
    <div className="living-room-scope flex flex-col h-full w-full">
      <DragStrip />
      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b shrink-0"
        style={{ borderColor: "var(--living-border-line, #E8E8E8)" }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label="返回茶水间列表"
          render={<AppLink href={p.rooms()} />}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-semibold truncate"
            style={{ color: "var(--living-text-primary, #1F2329)" }}
          >
            {isPending ? "加载中…" : (room?.name ?? "未知茶水间")}
          </div>
          {room?.description && (
            <div className="text-xs truncate" style={{ color: "var(--living-text-secondary, #86909C)" }}>
              {room.description}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setMemberSidebarOpen(!memberSidebarOpen)}
          aria-label={memberSidebarOpen ? "收起成员栏" : "展开成员栏"}
        >
          {memberSidebarOpen
            ? <PanelLeftClose className="size-4" />
            : <PanelLeftOpen className="size-4" />
          }
        </Button>
      </div>

      {/* Three-column body: left gutter (80px) + main + right gutter (80px, hidden) */}
      {/* Left member sidebar (200px) + center message area */}
      <div className="flex flex-1 min-h-0">
        {memberSidebarOpen && (
          <RoomMemberSidebar roomId={id} />
        )}

        {/* Center: message list + input */}
        <div className="flex flex-col flex-1 min-w-0">
          <RoomMessageList roomId={id} />
          <RoomMessageInput roomId={id} />
        </div>
      </div>
    </div>
  );
}
