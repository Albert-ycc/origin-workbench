"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { roomsOptions } from "@multica/core/rooms";
import { useWorkspacePaths } from "@multica/core/paths";
import { AppLink } from "../navigation";
import { CreateRoomModal } from "./components/create-room-modal";
import { DragStrip } from "../platform";
import type { Room } from "@multica/core/types";

export function RoomsPage() {
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isPending } = useQuery(roomsOptions(wsId));
  const rooms = data?.rooms ?? [];
  const activeRooms = rooms.filter((r) => !r.archived_at);
  const archivedRooms = rooms.filter((r) => r.archived_at);

  return (
    <div className="living-room-scope flex flex-col h-full w-full">
      <DragStrip />
      <div className="flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: "var(--living-border-line, #E8E8E8)" }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--living-text-primary, #1F2329)" }}>
            茶水间
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--living-text-secondary, #86909C)" }}>
            和你的 agent 朋友们一起聊天
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="text-sm px-4 py-1.5 rounded-lg transition-colors"
          style={{ background: "var(--living-accent-blue, #1677FF)", color: "#FFFFFF" }}
        >
          + 新建茶水间
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {isPending ? (
          <RoomsLoadingSkeleton />
        ) : activeRooms.length === 0 && archivedRooms.length === 0 ? (
          <RoomsEmptyState onCreate={() => setShowCreate(true)} />
        ) : (
          <div className="space-y-6">
            {activeRooms.length > 0 && (
              <section>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {activeRooms.map((room) => (
                    <RoomCard key={room.id} room={room} href={p.roomDetail(room.id)} />
                  ))}
                </div>
              </section>
            )}
            {archivedRooms.length > 0 && (
              <section>
                <h2
                  className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: "var(--living-text-secondary, #86909C)" }}
                >
                  已归档
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 opacity-60">
                  {archivedRooms.map((room) => (
                    <RoomCard key={room.id} room={room} href={p.roomDetail(room.id)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

function RoomCard({ room, href }: { room: Room; href: string }) {
  return (
    <AppLink
      href={href}
      className="block rounded-xl border p-4 transition-all hover:border-[#1677FF] hover:shadow-sm"
      style={{ borderColor: "var(--living-border-line, #E8E8E8)", background: "#FFFFFF" }}
    >
      <div className="font-medium text-sm truncate" style={{ color: "var(--living-text-primary, #1F2329)" }}>
        {room.name}
      </div>
      {room.description && (
        <div
          className="text-xs mt-1 line-clamp-2"
          style={{ color: "var(--living-text-secondary, #86909C)" }}
        >
          {room.description}
        </div>
      )}
      <div className="mt-3 text-[11px]" style={{ color: "var(--living-text-secondary, #86909C)" }}>
        {new Date(room.created_at).toLocaleDateString("zh-CN")} 创建
      </div>
    </AppLink>
  );
}

function RoomsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div
        className="text-5xl mb-4"
        style={{ fontFamily: '"Noto Emoji", sans-serif' }}
        aria-hidden
      >
        ☕
      </div>
      <h2 className="text-base font-semibold mb-1" style={{ color: "var(--living-text-primary, #1F2329)" }}>
        还没有茶水间
      </h2>
      <p className="text-sm mb-6" style={{ color: "var(--living-text-secondary, #86909C)" }}>
        创建一个茶水间，邀请你的 agent 朋友进来聊天
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="text-sm px-5 py-2 rounded-lg transition-colors"
        style={{ background: "var(--living-accent-blue, #1677FF)", color: "#FFFFFF" }}
      >
        新建第一个茶水间
      </button>
    </div>
  );
}

function RoomsLoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--living-border-line, #E8E8E8)" }}
        >
          <div className="h-4 w-3/4 rounded bg-gray-100" />
          <div className="mt-2 h-3 w-full rounded bg-gray-100" />
          <div className="mt-1 h-3 w-2/3 rounded bg-gray-100" />
          <div className="mt-3 h-3 w-1/3 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}
