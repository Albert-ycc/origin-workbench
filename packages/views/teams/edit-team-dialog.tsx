"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, Loader2, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { agentListOptions } from "@multica/core/workspace/queries";
import {
  useUpdateTeam,
  useAddTeamMember,
  useRemoveTeamMember,
} from "@multica/core/teams";
import type { Agent, Team } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
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

interface EditTeamDialogProps {
  team: Team;
  onClose: () => void;
}

export function EditTeamDialog({ team, onClose }: EditTeamDialogProps) {
  const wsId = useWorkspaceId();
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const updateTeam = useUpdateTeam();
  const addMember = useAddTeamMember();
  const removeMember = useRemoveTeamMember();

  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description);
  const [captainId, setCaptainId] = useState(team.captain_agent_id);
  const [memberIds, setMemberIds] = useState<Set<string>>(
    () =>
      new Set(
        team.members
          .filter((m) => m.role !== "captain")
          .map((m) => m.agent_id),
      ),
  );

  // candidates for captain = any non-archived agent in the workspace
  const liveAgents = useMemo(
    () => agents.filter((a) => !a.archived_at),
    [agents],
  );
  const liveAgentMap = useMemo(
    () => new Map(liveAgents.map((a) => [a.id, a])),
    [liveAgents],
  );

  const memberCandidates = useMemo(
    () =>
      liveAgents
        .filter((a) => a.id !== captainId)
        .sort((a, b) => a.name.localeCompare(b.name, "zh")),
    [liveAgents, captainId],
  );

  const toggleMember = (id: string) => {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitting =
    updateTeam.isPending || addMember.isPending || removeMember.isPending;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("团队名称不能为空");
      return;
    }
    if (!captainId) {
      toast.error("请选择团队负责人");
      return;
    }

    // 1) Patch team-level fields. The backend's PATCH supports any subset.
    const captainChanged = captainId !== team.captain_agent_id;
    if (
      trimmed !== team.name ||
      description !== team.description ||
      captainChanged
    ) {
      try {
        await updateTeam.mutateAsync({
          id: team.id,
          name: trimmed,
          description,
          captain_agent_id: captainChanged ? captainId : undefined,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "保存团队失败");
        return;
      }
    }

    // 2) Diff memberships. Captain is implicit — never appears in memberIds.
    // If the captain changed, backend role-swap turns the previous captain
    // into a member row. Include that in the "before" set so an unchecked
    // previous captain gets removed instead of lingering invisibly.
    const before = new Set(
      team.members
        .filter((m) => m.role !== "captain")
        .map((m) => m.agent_id),
    );
    if (captainChanged) before.add(team.captain_agent_id);
    const after = new Set(memberIds);
    const toAdd = [...after].filter((id) => !before.has(id) && id !== captainId);
    const toRemove = [...before].filter(
      (id) => !after.has(id) && id !== captainId,
    );

    try {
      for (const agentId of toAdd) {
        await addMember.mutateAsync({ teamId: team.id, agent_id: agentId });
      }
      for (const agentId of toRemove) {
        await removeMember.mutateAsync({ teamId: team.id, agentId });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新成员失败");
      return;
    }

    toast.success(`「${trimmed}」已更新`);
    onClose();
  };

  const captainAgent: Agent | undefined = liveAgentMap.get(captainId);

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" />
            编辑团队
          </DialogTitle>
          <DialogDescription>
            修改团队名称、职责、负责人和成员。保存后立即生效。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="edit-team-name" className="text-xs">
              团队名称
            </Label>
            <Input
              id="edit-team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：交付小队"
              maxLength={60}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-team-desc" className="text-xs">
              团队职责
            </Label>
            <Textarea
              id="edit-team-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话说清这个团队负责什么"
              rows={2}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">负责人</Label>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-1">
              {liveAgents.map((agent) => {
                const checked = agent.id === captainId;
                return (
                  <button
                    type="button"
                    key={agent.id}
                    onClick={() => {
                      setCaptainId(agent.id);
                      // If newly-promoted captain was previously a member,
                      // pull them out of the member set so the UI is
                      // consistent (captain is implicit).
                      setMemberIds((prev) => {
                        const next = new Set(prev);
                        next.delete(agent.id);
                        return next;
                      });
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                      checked
                        ? "bg-primary/10 hover:bg-primary/15"
                        : "hover:bg-muted",
                    )}
                  >
                    <ActorAvatar
                      actorType="agent"
                      actorId={agent.id}
                      size={28}
                      className="rounded-full"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="truncate text-sm">{agent.name}</span>
                        {checked && (
                          <Crown className="size-3 shrink-0 text-primary" />
                        )}
                      </div>
                      <div className="line-clamp-1 text-xs text-muted-foreground">
                        {agent.description || "暂无描述"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {!captainAgent && (
              <p className="text-xs text-destructive">
                <Sparkles className="mr-1 inline size-3" />
                负责人未选定，需要选一个智能体作为团队负责人。
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">团队成员</Label>
              <span className="text-xs text-muted-foreground">
                已选 {memberIds.size} / {memberCandidates.length}
              </span>
            </div>
            {memberCandidates.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                暂无可加入的其它智能体。
              </div>
            ) : (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-1">
                {memberCandidates.map((agent) => {
                  const checked = memberIds.has(agent.id);
                  return (
                    <button
                      type="button"
                      key={agent.id}
                      onClick={() => toggleMember(agent.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                        checked
                          ? "bg-primary/10 hover:bg-primary/15"
                          : "hover:bg-muted",
                      )}
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
                          {agent.description || "暂无描述"}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full border text-[10px]",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/30 text-transparent",
                        )}
                      >
                        ✓
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-3 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
