"use client";

import { useQuery } from "@tanstack/react-query";
import { roomAgentPersonaOptions, roomMembersOptions, useRemoveRoomMember, useUpsertRoomAgentPersona } from "@multica/core/rooms";
import { useWorkspaceId } from "@multica/core/hooks";
import { agentListOptions } from "@multica/core/workspace/queries";
import { ActorAvatar } from "@multica/views/common/actor-avatar";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Label } from "@multica/ui/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Badge } from "@multica/ui/components/ui/badge";
import { Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";

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
  const [personaAgentId, setPersonaAgentId] = useState<string | null>(null);

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
      className="room-member-sidebar flex h-full w-[200px] shrink-0 flex-col overflow-y-auto border-r"
    >
      <div className="flex items-center justify-between border-b px-3 py-3">
        <div className="flex items-center gap-1.5">
          <Users className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
          <p className="px-2 py-2 text-xs italic text-muted-foreground">
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
                <div className="flex-1 min-w-0">
                  <span className="block truncate text-xs text-foreground" title={agent?.name ?? agentId}>
                    {agent?.name ?? agentId}
                  </span>
                  {member.role && (
                    <Badge variant="outline" className="mt-0.5 h-4 px-1 text-[9px] leading-none">
                      {member.role === "owner" ? "房主" : "成员"}
                    </Badge>
                  )}
                </div>
                {member.member_type === "agent" && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`编辑${agent?.name ?? agentId}的茶水间人格`}
                      onClick={() => setPersonaAgentId(agentId)}
                    >
                      <Pencil className="size-3" />
                    </Button>
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
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {personaAgentId && (
        <PersonaEditDialog
          roomId={roomId}
          agentId={personaAgentId}
          open={!!personaAgentId}
          onOpenChange={(v) => { if (!v) setPersonaAgentId(null); }}
        />
      )}
    </div>
  );
}

function PersonaEditDialog({
  roomId,
  agentId,
  open,
  onOpenChange,
}: {
  roomId: string;
  agentId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: persona } = useQuery(roomAgentPersonaOptions(roomId, agentId));
  const upsert = useUpsertRoomAgentPersona(roomId, agentId);
  const [value, setValue] = useState("");

  // Sync local state when persona data loads for the first time.
  useEffect(() => {
    if (persona?.persona_override && value === "") {
      const override =
        typeof persona.persona_override === "string"
          ? persona.persona_override
          : JSON.stringify(persona.persona_override, null, 2);
      setValue(override);
    }
    // Only run when persona data first arrives; ignore subsequent updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona?.persona_override]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>茶水间人格设定</DialogTitle>
          <DialogDescription>
            为这位 Agent 在本茶水间中自定义说话风格。留空则使用 Agent 自己的默认人格。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="persona-override" className="text-xs">
              人格描述（persona override）
            </Label>
            <Textarea
              id="persona-override"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="例如：在这个茶水间里，你要表现得像一个幽默风趣的老朋友，用轻松的语调说话，偶尔开个玩笑…"
              rows={5}
              className="text-sm"
            />
          </div>
          {persona?.persona_override && (
            <p className="text-xs text-muted-foreground">
              当前已有人格设定。留空并保存即可清除。
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={async () => {
              try {
                await upsert.mutateAsync({
                  persona_override: value.trim() || undefined,
                });
                toast.success("人格设定已保存");
                onOpenChange(false);
              } catch {
                toast.error("保存失败");
              }
            }}
            disabled={upsert.isPending}
          >
            {upsert.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
