"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { agentListOptions } from "@multica/core/workspace/queries";
import {
  roomMembersOptions,
  roomOptions,
  useAddRoomMember,
  useDeleteRoom,
  useRoomsStore,
  useUpdateRoom,
} from "@multica/core/rooms";
import { DragStrip } from "../platform";
import { RoomMemberSidebar } from "./components/room-member-sidebar";
import { RoomMessageList } from "./components/room-message-list";
import { RoomMessageInput } from "./components/room-message-input";
import {
  Check,
  ChevronLeft,
  Loader2,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
} from "lucide-react";
import { useWorkspacePaths } from "@multica/core/paths";
import { AppLink, useNavigation } from "../navigation";
import { Button } from "@multica/ui/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { toast } from "sonner";
import type { Room } from "@multica/core/types";

interface RoomDetailPageProps {
  roomId?: string;
}

export function RoomDetailPage({ roomId }: RoomDetailPageProps) {
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const navigation = useNavigation();
  const memberSidebarOpen = useRoomsStore((s) => s.memberSidebarOpen);
  const setMemberSidebarOpen = useRoomsStore((s) => s.setMemberSidebarOpen);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteRoom = useDeleteRoom();

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
          nativeButton={false}
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
          onClick={() => setSettingsOpen(true)}
          aria-label="设置茶水间"
          disabled={!room}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
          aria-label="删除茶水间"
          disabled={!room}
        >
          <Trash2 className="size-4" />
        </Button>
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
          <RoomMemberSidebar roomId={id} onAddMember={() => setAddMemberOpen(true)} />
        )}

        {/* Center: message list + input */}
        <div className="flex flex-col flex-1 min-w-0">
          <RoomMessageList roomId={id} />
          <RoomMessageInput roomId={id} />
        </div>
      </div>

      <AddRoomMemberDialog
        roomId={id}
        open={addMemberOpen}
        onOpenChange={setAddMemberOpen}
      />
      {room && (
        <RoomSettingsDialog
          room={room}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{room?.name ?? "茶水间"}」？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作无法撤销。茶水间消息、成员关系和智能体设定会一并删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRoom.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteRoom.isPending}
              onClick={async () => {
                try {
                  await deleteRoom.mutateAsync(id);
                  toast.success("茶水间已删除");
                  setDeleteOpen(false);
                  navigation.push(p.rooms());
                } catch {
                  toast.error("删除茶水间失败");
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteRoom.isPending ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RoomSettingsDialog({
  room,
  open,
  onOpenChange,
}: {
  room: Room;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? "");
  const updateRoom = useUpdateRoom(room.id);

  async function save() {
    const nextName = name.trim();
    if (!nextName) {
      toast.error("茶水间名称不能为空");
      return;
    }
    try {
      await updateRoom.mutateAsync({
        name: nextName,
        description: description.trim() || undefined,
      });
      toast.success("茶水间已更新");
      onOpenChange(false);
    } catch {
      toast.error("更新茶水间失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>设置茶水间</DialogTitle>
          <DialogDescription>修改名称和描述，不影响已有消息。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="room-name">名称</Label>
            <Input id="room-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="room-description">描述</Label>
            <Textarea
              id="room-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={400}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={updateRoom.isPending || !name.trim()}>
            {updateRoom.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRoomMemberDialog({
  roomId,
  open,
  onOpenChange,
}: {
  roomId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wsId = useWorkspaceId();
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const { data: agents = [], isPending: agentsPending } = useQuery({
    ...agentListOptions(wsId),
    enabled: open && !!wsId,
  });
  const { data: memberData } = useQuery({
    ...roomMembersOptions(roomId),
    enabled: open && !!roomId,
  });
  const addMember = useAddRoomMember(roomId);

  const existingAgentIds = useMemo(
    () =>
      new Set(
        (memberData?.members ?? [])
          .filter((member) => member.member_type === "agent")
          .map((member) => member.agent_id ?? member.member_id),
      ),
    [memberData?.members],
  );
  const availableAgents = useMemo(
    () => agents.filter((agent) => !existingAgentIds.has(agent.id)),
    [agents, existingAgentIds],
  );
  const selectedAgents = useMemo(
    () => availableAgents.filter((agent) => selectedAgentIds.includes(agent.id)),
    [availableAgents, selectedAgentIds],
  );

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    );
  }

  async function handleAddMember() {
    if (selectedAgents.length === 0) return;
    try {
      for (const agent of selectedAgents) {
        await addMember.mutateAsync({
          member_type: "agent",
          member_id: agent.id,
          role: "participant",
        });
      }
      toast.success(`已邀请 ${selectedAgents.length} 位成员加入茶水间`);
      setSelectedAgentIds([]);
      onOpenChange(false);
    } catch {
      toast.error("邀请失败，请稍后重试");
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setSelectedAgentIds([]);
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>邀请成员</DialogTitle>
          <DialogDescription>
            可一次选择多个智能体加入这个茶水间。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">可邀请成员</Label>
            <span className="text-xs text-muted-foreground">
              已选 {selectedAgentIds.length} / {availableAgents.length}
            </span>
          </div>
          {agentsPending ? (
            <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
              正在加载智能体…
            </div>
          ) : availableAgents.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
              没有可加入的智能体
            </div>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
              {availableAgents.map((agent) => {
                const selected = selectedAgentIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                      selected
                        ? "bg-primary/10 hover:bg-primary/15"
                        : "hover:bg-muted",
                    )}
                    aria-pressed={selected}
                    onClick={() => toggleAgent(agent.id)}
                  >
                    <ActorAvatar
                      actorType="agent"
                      actorId={agent.id}
                      size={28}
                      className="rounded-full"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{agent.name}</div>
                      <div className="line-clamp-1 text-xs text-muted-foreground">
                        {agent.description || agent.status || "暂无描述"}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30 text-transparent",
                      )}
                    >
                      <Check className="size-3" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => void handleAddMember()}
            disabled={selectedAgents.length === 0 || addMember.isPending}
          >
            {addMember.isPending && <Loader2 className="size-3 animate-spin" />}
            {addMember.isPending
              ? "加入中…"
              : selectedAgents.length > 0
                ? `加入 ${selectedAgents.length} 位成员`
                : "加入茶水间"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
