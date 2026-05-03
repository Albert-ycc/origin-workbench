"use client";

import { useMemo, useState } from "react";
import { Loader2, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import type { Agent } from "@multica/core/types";
import { useCreateTeam } from "@multica/core/teams";
import { useWorkspacePaths } from "@multica/core/paths";
import { useNavigation } from "../../navigation";
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
import { ActorAvatar } from "../../common/actor-avatar";

interface CreateTeamDialogProps {
  captain: Agent;
  agents: Agent[];
  onClose: () => void;
}

export function CreateTeamDialog({
  captain,
  agents,
  onClose,
}: CreateTeamDialogProps) {
  const wsPaths = useWorkspacePaths();
  const navigation = useNavigation();
  const createTeam = useCreateTeam();

  const [name, setName] = useState(`${captain.name} 的团队`);
  const [description, setDescription] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());

  const candidates = useMemo(
    () =>
      agents
        .filter((a) => !a.archived_at && a.id !== captain.id)
        .sort((a, b) => a.name.localeCompare(b.name, "zh")),
    [agents, captain.id],
  );

  const toggleMember = (id: string) => {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("先给团队起个名字");
      return;
    }
    createTeam.mutate(
      {
        name: trimmed,
        description: description.trim() || undefined,
        captain_agent_id: captain.id,
        member_agent_ids: Array.from(memberIds),
      },
      {
        onSuccess: (team) => {
          toast.success(`「${team.name}」已创建`);
          onClose();
          navigation.push(`${wsPaths.teams()}/${team.id}`);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "创建团队失败");
        },
      },
    );
  };

  const submitting = createTeam.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" />
            创建团队
          </DialogTitle>
          <DialogDescription>
            以 <span className="font-medium text-foreground">{captain.name}</span>{" "}
            为负责人，邀请其它智能体加入，组成一个可在群聊中协作的小队。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <section className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <ActorAvatar
              actorType="agent"
              actorId={captain.id}
              size={44}
              className="rounded-full"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {captain.name}
                </span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                  负责人
                </span>
              </div>
              <p className="line-clamp-1 text-xs text-muted-foreground">
                {captain.description || "暂无职责描述"}
              </p>
            </div>
          </section>

          <div className="space-y-1.5">
            <Label htmlFor="team-name" className="text-xs">
              团队名称
            </Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：交付小队"
              maxLength={60}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="team-desc" className="text-xs">
              团队职责（可选）
            </Label>
            <Textarea
              id="team-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话说清这个团队负责什么"
              rows={2}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">团队成员</Label>
              <span className="text-xs text-muted-foreground">
                已选 {memberIds.size} / {candidates.length}
              </span>
            </div>
            {candidates.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                <Sparkles className="mx-auto mb-1 size-4" />
                还没有可加入的其它智能体。先创建几个智能体，再回来组队。
              </div>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
                {candidates.map((agent) => {
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
                        size={32}
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
            创建团队
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
