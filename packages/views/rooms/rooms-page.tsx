"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { roomMembersOptions, roomsOptions } from "@multica/core/rooms";
import { useWorkspacePaths } from "@multica/core/paths";
import { AppLink } from "../navigation";
import { CreateRoomModal } from "./components/create-room-modal";
import { DragStrip } from "../platform";
import { ActorAvatar } from "../common/actor-avatar";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { cn } from "@multica/ui/lib/utils";
import { ArrowUpDown, Coffee, MoreHorizontal, Plus, Search } from "lucide-react";
import type { Room, RoomMember } from "@multica/core/types";
import { useRoomAmbientTheme, type RoomAmbientTheme } from "./room-ambient-theme";
import { getTeaRoomCover } from "./room-covers";

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

type RoomStatus = "active" | "quiet" | "archived";
type RoomFilter = "all" | RoomStatus;

const ROOM_FILTERS: RoomFilter[] = ["all", "active", "quiet", "archived"];

const roomFilterLabel: Record<RoomFilter, string> = {
  all: "全部",
  active: "进行中",
  quiet: "稍安静",
  archived: "已结束",
};

const roomStatusCopy: Record<RoomStatus, { label: string; dotClass: string }> = {
  active: { label: "进行中", dotClass: "bg-emerald-500" },
  quiet: { label: "稍安静", dotClass: "bg-amber-500" },
  archived: { label: "已结束", dotClass: "bg-muted-foreground/45" },
};

const RECENT_ROOM_MS = 30 * 60 * 1000;

export function RoomsPage() {
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const ambientTheme = useRoomAmbientTheme();
  const ambient = ambientCopy[ambientTheme];
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RoomFilter>("all");
  const now = Date.now();

  const { data, isPending, isError, refetch } = useQuery(roomsOptions(wsId));
  const rooms = useMemo(() => data?.rooms ?? [], [data?.rooms]);
  const activeRooms = useMemo(() => rooms.filter((r) => !r.archived_at), [rooms]);
  const hasRooms = rooms.length > 0;

  const statusCounts = useMemo(() => {
    const counts: Record<RoomFilter, number> = {
      all: rooms.length,
      active: 0,
      quiet: 0,
      archived: 0,
    };
    for (const room of rooms) {
      counts[getRoomStatus(room, now)] += 1;
    }
    return counts;
  }, [rooms, now]);

  const visibleRooms = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rooms
      .filter((room) => {
        if (filter !== "all" && getRoomStatus(room, now) !== filter) return false;
        if (!query) return true;
        return `${room.name} ${room.description ?? ""}`.toLowerCase().includes(query);
      })
      .sort((a, b) => getRoomTimestamp(b) - getRoomTimestamp(a));
  }, [rooms, filter, search, now]);

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
              {activeRooms.length > 0 && (
                <span className="font-mono text-sm tabular-nums text-muted-foreground/80">
                  {activeRooms.length}
                </span>
              )}
              <span className="room-time-pill shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                {ambient.label}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              查看正在进行的协作闲聊。
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} className="shrink-0">
          <Plus className="size-3.5" />
          新建茶水间
        </Button>
      </div>

      <div className="room-list-body flex min-h-0 flex-1 flex-col px-8 py-6">
        {isPending ? (
          <RoomsLoadingSkeleton />
        ) : isError ? (
          <RoomsErrorState onRetry={() => void refetch()} />
        ) : !hasRooms ? (
          <RoomsEmptyState ambient={ambient} onCreate={() => setShowCreate(true)} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
            <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索茶水间..."
                  className="h-9 pl-9 text-sm"
                />
              </div>
              <div className="ml-auto hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                <span className="font-mono tabular-nums">
                  {visibleRooms.length} / {rooms.length}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ArrowUpDown className="size-3.5" />
                  最近活跃
                </span>
              </div>
            </div>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
              {ROOM_FILTERS.map((item) => (
                <RoomFilterChip
                  key={item}
                  active={filter === item}
                  label={roomFilterLabel[item]}
                  count={statusCounts[item]}
                  dotClass={item === "all" ? undefined : roomStatusCopy[item].dotClass}
                  onClick={() => setFilter(item)}
                />
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {visibleRooms.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleRooms.map((room) => (
                    <RoomCard key={room.id} room={room} href={p.roomDetail(room.id)} now={now} />
                  ))}
                </div>
              ) : (
                <NoMatchingRooms search={search} />
              )}
            </div>
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

function RoomCard({ room, href, now }: { room: Room; href: string; now: number }) {
  const { data } = useQuery(roomMembersOptions(room.id));
  const members = getActiveRoomMembers(data?.members ?? []);
  const participantCount = members.length;
  const visibleMembers = members.slice(0, 4);
  const remainingMembers = Math.max(participantCount - visibleMembers.length, 0);
  const status = getRoomStatus(room, now);
  const statusMeta = roomStatusCopy[status];
  const cover = getTeaRoomCover(room);

  return (
    <AppLink
      href={href}
      aria-label={`打开茶水间 ${room.name}`}
      className={cn(
        "room-card group relative flex min-h-[24rem] overflow-hidden rounded-lg border border-border/80 bg-card text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        status === "archived" && "opacity-70 grayscale",
      )}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-muted/35 to-transparent" />
      <span className="absolute left-1/2 top-4 h-1 w-11 -translate-x-1/2 rounded-full bg-muted-foreground/20 shadow-inner" />
      <span className="absolute right-4 top-3 text-muted-foreground" aria-hidden="true">
        <MoreHorizontal className="size-4" />
      </span>

      <div className="relative flex min-w-0 flex-1 flex-col px-4 pb-4 pt-9">
        <div className="rounded-lg border border-border/70 bg-[#fbfaf7] p-2">
          <img
            src={cover.src}
            alt={`${room.name} 封面`}
            className="aspect-[4/3] w-full rounded-md object-cover"
            draggable={false}
          />
        </div>

        <div className="mt-4 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-normal text-foreground">
              {room.name}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {participantCount} 人在聊
            </p>
          </div>
          <span className="room-count-pill shrink-0 rounded-full px-2 py-0.5 text-[11px]">
            {statusMeta.label}
          </span>
        </div>

        <p
          className={cn(
            "mt-2 line-clamp-2 min-h-8 text-xs leading-4",
            room.description ? "text-muted-foreground" : "italic text-muted-foreground/55",
          )}
        >
          {room.description || "这个茶水间还没有写主题说明。"}
        </p>

        <div className="mt-auto flex min-w-0 items-center justify-between gap-3 pt-4">
          <div className="flex min-w-0 items-center">
            {visibleMembers.length > 0 ? (
              <>
                {visibleMembers.map((member, index) => (
                  <MemberAvatar key={member.id} member={member} offset={index > 0} />
                ))}
                {remainingMembers > 0 && (
                  <span className="-ml-1 inline-flex size-6 items-center justify-center rounded-full border border-background bg-muted text-[10px] font-medium text-muted-foreground">
                    +{remainingMembers}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">暂无成员</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", statusMeta.dotClass)} />
            <span>{formatLastActive(room, status)}</span>
          </div>
        </div>
      </div>
    </AppLink>
  );
}

function MemberAvatar({ member, offset }: { member: RoomMember; offset: boolean }) {
  if (member.member_type === "agent" && member.agent_id) {
    return (
      <ActorAvatar
        actorType="agent"
        actorId={member.agent_id}
        size={24}
        className={cn("rounded-full border-2 border-background", offset && "-ml-1.5")}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium text-muted-foreground",
        offset && "-ml-1.5",
      )}
    >
      你
    </span>
  );
}

function RoomFilterChip({
  active,
  label,
  count,
  dotClass,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  dotClass?: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn(
        "h-8 gap-1.5 text-xs",
        active ? "bg-accent text-accent-foreground hover:bg-accent/80" : "text-muted-foreground",
      )}
    >
      {dotClass && <span className={cn("size-1.5 rounded-full", dotClass)} />}
      <span>{label}</span>
      <span className="font-mono tabular-nums text-muted-foreground/70">{count}</span>
    </Button>
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
      <div className="h-14 shrink-0 border-b px-4 py-2.5">
        <div className="h-9 w-full max-w-sm rounded-md bg-muted" />
      </div>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 w-20 rounded-md bg-muted" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="min-h-[24rem] rounded-lg border bg-card p-4">
            <div className="mx-auto h-1 w-11 rounded-full bg-muted" />
            <div className="mt-8 aspect-[4/3] rounded-lg bg-muted" />
            <div className="mt-4 h-4 w-2/3 rounded bg-muted" />
            <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
            <div className="mt-2 h-3 w-full rounded bg-muted" />
            <div className="mt-1 h-3 w-3/4 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

function NoMatchingRooms({ search }: { search: string }) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
      <h2 className="text-sm font-medium text-foreground">没有匹配的茶水间</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {search.trim() ? `没有匹配“${search.trim()}”的茶水间。` : "当前筛选条件下没有茶水间。"}
      </p>
    </div>
  );
}

function getRoomStatus(room: Room, now: number): RoomStatus {
  if (room.archived_at) return "archived";
  const lastActiveAt = getRoomTimestamp(room);
  if (!Number.isFinite(lastActiveAt)) return "active";
  return now - lastActiveAt <= RECENT_ROOM_MS ? "active" : "quiet";
}

function getRoomTimestamp(room: Room) {
  const value = room.last_active_at ?? room.updated_at ?? room.created_at;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getActiveRoomMembers(members: readonly RoomMember[]) {
  return members.filter((member) => !member.left_at);
}

function formatLastActive(room: Room, status: RoomStatus) {
  if (status === "archived") return "已结束";
  const timestamp = getRoomTimestamp(room);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "最近活跃";
  const diff = Math.max(Date.now() - timestamp, 0);
  if (diff < 60_000) return "刚刚活跃";
  if (diff < 60 * 60_000) return `最近 ${Math.floor(diff / 60_000)} 分钟活跃`;
  if (diff < 24 * 60 * 60_000) return `最近 ${Math.floor(diff / (60 * 60_000))} 小时活跃`;
  return `${new Date(timestamp).toLocaleDateString("zh-CN")} 活跃`;
}
