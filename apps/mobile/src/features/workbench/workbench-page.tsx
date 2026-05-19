import { useMemo, useState } from "react";
import { ArrowUpRight, SendHorizontal } from "lucide-react";
import { demoMissions, demoRisks } from "../../fixtures/mobile-demo-data";
import type { Mission, QuickInputDraft, RiskItem } from "../../types";
import {
  ActionButton,
  EmptyState,
  MissionStatusPill,
  MobilePage,
  MobileSection,
  PriorityPill,
  RiskIcon,
} from "../../components";

interface WorkbenchPageProps {
  missions?: Mission[];
  risks?: RiskItem[];
  onQuickSubmit?: (draft: QuickInputDraft) => void;
  onOpenMission?: (missionId: string) => void;
  onOpenRisk?: (riskId: string) => void;
}

export function WorkbenchPage({
  missions = demoMissions,
  risks = demoRisks,
  onQuickSubmit,
  onOpenMission,
  onOpenRisk,
}: WorkbenchPageProps) {
  const [draft, setDraft] = useState<QuickInputDraft>({ title: "", context: "" });
  const activeMissions = useMemo(
    () => missions.filter((mission) => mission.status === "running" || mission.status === "waiting"),
    [missions],
  );

  function submitDraft() {
    const title = draft.title.trim();
    const context = draft.context.trim();
    if (!title && !context) return;
    onQuickSubmit?.({ title, context });
    setDraft({ title: "", context: "" });
  }

  return (
    <MobilePage title="工作台" subtitle="捕捉意图、跟进 Mission、处理需要拍板的风险。">
      <MobileSection title="快速输入" meta="先记下来，再升级成 Mission">
        <div className="flex flex-col gap-2">
          <input
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            placeholder="一句话描述你要推进的事"
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          <textarea
            value={draft.context}
            onChange={(event) => setDraft((current) => ({ ...current, context: event.target.value }))}
            placeholder="补充上下文、约束、验收口径"
            rows={3}
            className="min-h-20 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm leading-5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          <div className="flex justify-end">
            <ActionButton intent="primary" onClick={submitDraft}>
              <SendHorizontal className="size-4" />
              发送
            </ActionButton>
          </div>
        </div>
      </MobileSection>

      <MobileSection title="正在执行" meta={`${activeMissions.length} 个 Mission`}>
        {activeMissions.length > 0 ? (
          <div className="flex flex-col gap-2">
            {activeMissions.map((mission) => (
              <button
                key={mission.id}
                type="button"
                onClick={() => onOpenMission?.(mission.id)}
                className="rounded-lg border border-border bg-background p-3 text-left transition active:bg-muted"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-semibold">{mission.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{mission.summary}</p>
                  </div>
                  <MissionStatusPill status={mission.status} />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${mission.progress}%` }} />
                  </div>
                  <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                    {mission.progress}%
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{mission.currentStep}</span>
                  <ArrowUpRight className="size-3.5 shrink-0" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无执行中的 Mission" description="从快速输入或想法池升级后会出现在这里。" />
        )}
      </MobileSection>

      <MobileSection title="需要确认" meta={`${risks.length} 个风险 / 决策点`}>
        {risks.length > 0 ? (
          <div className="flex flex-col gap-2">
            {risks.map((risk) => (
              <button
                key={risk.id}
                type="button"
                onClick={() => onOpenRisk?.(risk.id)}
                className="flex gap-3 rounded-lg border border-border bg-background p-3 text-left transition active:bg-muted"
              >
                <div className="mt-0.5">
                  <RiskIcon />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="line-clamp-1 text-sm font-medium">{risk.title}</p>
                    <PriorityPill priority={risk.priority} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{risk.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {risk.source}
                    {risk.dueLabel ? ` · ${risk.dueLabel}` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="没有待确认风险" description="高风险阻塞项会集中显示，方便移动端快速拍板。" />
        )}
      </MobileSection>
    </MobilePage>
  );
}
