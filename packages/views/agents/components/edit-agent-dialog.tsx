"use client";

import type { Agent, AgentRuntime, MemberWithUser } from "@multica/core/types";
import type { AgentPresenceDetail } from "@multica/core/agents";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { AgentDetailInspector } from "./agent-detail-inspector";

/**
 * Thin wrapper that hosts the original AgentDetailInspector inside a modal,
 * called from the hero's "编辑" button. The inspector stays the single
 * source of edit truth for avatar / name / description / runtime / model /
 * visibility / concurrency / skills / archive — we just relocated where
 * users find it. When the new hero block grows its own inline-edit
 * affordances we can shrink this dialog to non-edit fields, but for now
 * keeping the inspector intact preserves every existing edit guard
 * (permission gating, validation, optimistic update) for free.
 */
export function EditAgentDialog({
  agent,
  runtime,
  owner,
  presence,
  runtimes,
  members,
  currentUserId,
  canEdit,
  onUpdate,
  onClose,
}: {
  agent: Agent;
  runtime: AgentRuntime | null;
  owner: MemberWithUser | null;
  presence: AgentPresenceDetail | null | undefined;
  runtimes: AgentRuntime[];
  members: MemberWithUser[];
  currentUserId: string | null;
  canEdit: boolean;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto p-0">
        <DialogHeader className="border-b px-5 pb-3 pt-4">
          <DialogTitle className="text-base">编辑智能体</DialogTitle>
          <DialogDescription className="text-xs">
            修改头像、身份、运行环境、可见性、并发与技能。
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 py-4">
          <AgentDetailInspector
            agent={agent}
            runtime={runtime}
            owner={owner}
            presence={presence}
            runtimes={runtimes}
            members={members}
            currentUserId={currentUserId}
            canEdit={canEdit}
            onUpdate={onUpdate}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
