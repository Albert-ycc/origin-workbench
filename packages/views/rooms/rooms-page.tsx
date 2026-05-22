"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { roomsOptions } from "@multica/core/rooms";
import { useWorkspacePaths } from "@multica/core/paths";
import { AppLink } from "../navigation";
import { CreateRoomModal } from "./components/create-room-modal";
import { DragStrip } from "../platform";
import { Button } from "@multica/ui/components/ui/button";
import { CalendarDays, ChevronRight, Coffee, MessagesSquare, Plus } from "lucide-react";
import type { Room } from "@multica/core/types";
import { useRoomAmbientTheme, type RoomAmbientTheme } from "./room-ambient-theme";

const ambientCopy: Record<RoomAmbientTheme, { label: string; title: string; subtitle: string }> = {
  morning: {
    label: "早间",
    title: "早场茶水间",
    subtitle: "给今天的协作先热一杯。",
  },
  day: {
    label: "日间",
    title: "日间茶水间",
    subtitle: "随时拉几位智能体把想法说开。",
  },
  evening: {
    label: "傍晚",
    title: "傍晚茶水间",
    subtitle: "把白天沉下来的问题聚一聚。",
  },
  night: {
    label: "夜间",
    title: "夜间茶水间",
    subtitle: "低亮度待机，不打断深夜工作节奏。",
  },
};

export function RoomsPage() {
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const ambientTheme = useRoomAmbientTheme();
  const ambient = ambientCopy[ambientTheme];
  const [showCreate, setShowCreate] = useState(false);

  const { data, isPending, isError, refetch } = useQuery(roomsOptions(wsId));
  const rooms = data?.rooms ?? [];
  const activeRooms = rooms.filter((r) => !r.archived_at);
  const archivedRooms = rooms.filter((r) => r.archived_at);

  return (
    <div className="living-room-scope flex h-full w-full flex-col" data-room-theme={ambientTheme}>
      <DragStrip />
      <div className="room-shell-header flex items-center justify-between gap-4 border-b px-8 py-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="room-header-mark flex size-11 shrink-0 items-center justify-center rounded-lg">
            <Coffee className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">
                茶水间
              </h1>
              <span className="room-time-pill shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                {ambient.label}
              </span>
            </div>
            <p className="mt-1 truncate text-xs">
              {ambient.title} · {activeRooms.length} 个开放房间
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} className="shrink-0">
          <Plus className="size-3.5" />
          新建茶水间
        </Button>
      </div>

      <div className="room-list-body flex-1 overflow-y-auto px-8 py-6">
        {isPending ? (
          <RoomsLoadingSkeleton />
        ) : isError ? (
          <RoomsErrorState onRetry={() => void refetch()} />
        ) : activeRooms.length === 0 && archivedRooms.length === 0 ? (
          <RoomsEmptyState ambient={ambient} onCreate={() => setShowCreate(true)} />
        ) : (
          <div className="space-y-6">
            {activeRooms.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">开放中的茶水间</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {ambient.subtitle}
                    </p>
                  </div>
                  <span className="room-count-pill rounded-full px-2.5 py-1 text-xs">
                    {activeRooms.length} 个
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {activeRooms.map((room) => (
                    <RoomCard key={room.id} room={room} href={p.roomDetail(room.id)} />
                  ))}
                </div>
              </section>
            )}
            {archivedRooms.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  已归档
                </h2>
                <div className="grid grid-cols-1 gap-3 opacity-70 sm:grid-cols-2 lg:grid-cols-3">
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
      className="room-card group block rounded-lg border p-4 transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="room-card-icon flex size-9 shrink-0 items-center justify-center rounded-lg">
          <MessagesSquare className="size-4" />
        </div>
        <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="mt-4 truncate text-sm font-semibold text-foreground">
        {room.name}
      </div>
      {room.description && (
        <div className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-muted-foreground">
          {room.description}
        </div>
      )}
      <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CalendarDays className="size-3" />
        {new Date(room.created_at).toLocaleDateString("zh-CN")} 创建
      </div>
    </AppLink>
  );
}

function RoomsEmptyState({
  ambient,
  onCreate,
}: {
  ambient: (typeof ambientCopy)[RoomAmbientTheme];
  onCreate: () => void;
}) {
  return (
    <div className="room-empty-state mx-auto grid min-h-[520px] w-full max-w-5xl items-center gap-8 py-8 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="text-left">
        <span className="room-time-pill rounded-full px-2.5 py-1 text-xs font-medium">
          {ambient.label}
        </span>
        <h2 className="mt-4 text-2xl font-semibold tracking-normal text-foreground">
          还没有茶水间
        </h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          {ambient.subtitle}
        </p>
        <Button onClick={onCreate} className="mt-6">
          <Plus className="size-4" />
          新建第一个茶水间
        </Button>
      </div>
      <div className="room-empty-preview rounded-lg border p-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <div className="room-header-mark flex size-9 items-center justify-center rounded-lg">
              <Coffee className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">候场桌</div>
              <div className="text-xs text-muted-foreground">智能体可以在这里自然接话</div>
            </div>
          </div>
          <span className="room-count-pill rounded-full px-2 py-0.5 text-[11px]">
            空
          </span>
        </div>
        <div className="space-y-3 pt-4">
          <PreviewMessage align="left" name="产品经理" text="先把问题背景说清楚，我来补用户视角。" />
          <PreviewMessage align="right" name="你" text="等第一个茶水间创建后再开始。" />
          <PreviewMessage align="left" name="技术架构师" text="我会把实现风险和依赖拆出来。" />
        </div>
      </div>
    </div>
  );
}

function PreviewMessage({
  align,
  name,
  text,
}: {
  align: "left" | "right";
  name: string;
  text: string;
}) {
  return (
    <div className={align === "right" ? "flex justify-end" : "flex justify-start"}>
      <div className={align === "right" ? "room-preview-bubble is-user" : "room-preview-bubble"}>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide">
          {name}
        </div>
        <div className="text-sm leading-5">
          {text}
        </div>
      </div>
    </div>
  );
}

function RoomsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h2 className="text-base font-semibold mb-1 text-foreground">茶水间加载失败</h2>
      <p className="text-sm mb-6 text-muted-foreground">
        网络或后端暂时不可用，重试后再查看房间列表。
      </p>
      <Button variant="outline" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

function RoomsLoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="room-card rounded-lg border p-4"
        >
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="mt-2 h-3 w-full rounded bg-muted" />
          <div className="mt-1 h-3 w-2/3 rounded bg-muted" />
          <div className="mt-3 h-3 w-1/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
