import { useState } from "react";
import { Plus, UserRoundCog } from "lucide-react";
import { demoAgents } from "../../fixtures/mobile-demo-data";
import type { AgentCreateDraft, OriginAgent } from "../../types";
import { ActionButton, AgentStatusPill, MobilePage, MobileSection, StatusPill } from "../../components";

interface AgentsPageProps {
  agents?: OriginAgent[];
  onCreateAgent?: (draft: AgentCreateDraft) => void;
  onOpenAgent?: (agentId: string) => void;
}

export function AgentsPage({ agents = demoAgents, onCreateAgent, onOpenAgent }: AgentsPageProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<AgentCreateDraft>({
    name: "",
    role: "",
    capabilityText: "",
  });

  function submitAgent() {
    const nextDraft = {
      name: draft.name.trim(),
      role: draft.role.trim(),
      capabilityText: draft.capabilityText.trim(),
    };
    if (!nextDraft.name || !nextDraft.role) return;
    onCreateAgent?.(nextDraft);
    setDraft({ name: "", role: "", capabilityText: "" });
    setIsCreating(false);
  }

  return (
    <MobilePage
      title="Agent"
      subtitle="管理可调度的本地协作角色。"
      rightSlot={
        <ActionButton intent="primary" onClick={() => setIsCreating((value) => !value)}>
          <Plus className="size-4" />
          新建
        </ActionButton>
      }
    >
      {isCreating ? (
        <MobileSection title="新建 Agent" meta="先描述职责和能力边界">
          <div className="flex flex-col gap-2">
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Agent 名称"
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <input
              value={draft.role}
              onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}
              placeholder="负责范围，例如：前端集成"
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <textarea
              value={draft.capabilityText}
              onChange={(event) => setDraft((current) => ({ ...current, capabilityText: event.target.value }))}
              placeholder="能力标签，用逗号分隔"
              rows={3}
              className="min-h-20 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm leading-5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <div className="flex justify-end gap-2">
              <ActionButton onClick={() => setIsCreating(false)}>取消</ActionButton>
              <ActionButton intent="primary" onClick={submitAgent}>创建</ActionButton>
            </div>
          </div>
        </MobileSection>
      ) : null}

      <MobileSection title="Agent 列表" meta={`${agents.length} 个可用角色`}>
        <div className="flex flex-col gap-2">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onOpenAgent?.(agent.id)}
              className="rounded-lg border border-border bg-background p-3 text-left transition active:bg-muted"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserRoundCog className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-sm font-semibold">{agent.name}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{agent.role}</p>
                    </div>
                    <AgentStatusPill status={agent.status} />
                  </div>
                  <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
                    {agent.currentMission ?? agent.workloadLabel}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {agent.capabilities.map((capability) => (
                      <StatusPill key={capability.id} tone="muted">
                        {capability.label}
                      </StatusPill>
                    ))}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </MobileSection>
    </MobilePage>
  );
}
