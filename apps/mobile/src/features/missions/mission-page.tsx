import { MessageSquarePlus } from "lucide-react";
import { demoMissions } from "../../fixtures/mobile-demo-data";
import type { Mission, MissionAction } from "../../types";
import {
  ActionButton,
  EmptyState,
  MissionControlIcon,
  MissionStatusPill,
  MobilePage,
  MobileSection,
  PriorityPill,
  TimelineIcon,
} from "../../components";

const defaultActions: MissionAction[] = [
  { id: "pause", label: "暂停", intent: "neutral" },
  { id: "resume", label: "继续", intent: "primary" },
  { id: "abort", label: "中断", intent: "danger" },
];

interface MissionPageProps {
  mission?: Mission;
  actions?: MissionAction[];
  onAction?: (actionId: MissionAction["id"], missionId: string) => void;
  onSubmitContext?: (missionId: string) => void;
}

export function MissionPage({
  mission = demoMissions[0],
  actions = defaultActions,
  onAction,
  onSubmitContext,
}: MissionPageProps) {
  if (!mission) {
    return (
      <MobilePage title="Mission" subtitle="查看执行进度与时间线。">
        <EmptyState title="未选择 Mission" description="从工作台打开一个正在执行的 Mission。" />
      </MobilePage>
    );
  }

  return (
    <MobilePage
      title="Mission"
      subtitle={mission.title}
      rightSlot={<MissionStatusPill status={mission.status} />}
    >
      <MobileSection title="进度" meta={`开始 ${mission.startedAtLabel} · ETA ${mission.etaLabel}`}>
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-semibold">{mission.summary}</p>
              <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{mission.currentStep}</p>
            </div>
            <span className="text-2xl font-semibold tabular-nums">{mission.progress}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-background">
            <div className="h-full rounded-full bg-primary" style={{ width: `${mission.progress}%` }} />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {actions.map((action) => (
            <ActionButton
              key={action.id}
              intent={action.intent}
              onClick={() => onAction?.(action.id, mission.id)}
            >
              <MissionControlIcon action={action.id} />
              {action.label}
            </ActionButton>
          ))}
        </div>
      </MobileSection>

      <MobileSection title="执行时间线" meta={`${mission.timeline.length} 条记录`}>
        <div className="flex flex-col gap-3">
          {mission.timeline.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[1.25rem_1fr] gap-2">
              <div className="flex flex-col items-center">
                <TimelineIcon status={item.status} />
                {index < mission.timeline.length - 1 ? <div className="mt-1 h-full w-px bg-border" /> : null}
              </div>
              <div className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="line-clamp-1 text-sm font-medium">{item.title}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{item.timeLabel}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </MobileSection>

      <MobileSection title="补充上下文" meta="Agent 当前需要的信息">
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="flex gap-2">
            <MessageSquarePlus className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-sm leading-6">
              {mission.contextRequest ?? "当前 Mission 没有额外上下文请求。"}
            </p>
          </div>
          <textarea
            rows={3}
            placeholder="输入补充信息、文件线索或决策口径"
            className="mt-3 min-h-20 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm leading-5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          <div className="mt-2 flex justify-end">
            <ActionButton intent="primary" onClick={() => onSubmitContext?.(mission.id)}>
              提交上下文
            </ActionButton>
          </div>
        </div>
      </MobileSection>

      <MobileSection title="关联风险" meta={`${mission.risks.length} 个`}>
        {mission.risks.length > 0 ? (
          <div className="flex flex-col gap-2">
            {mission.risks.map((risk) => (
              <div key={risk.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="line-clamp-1 text-sm font-medium">{risk.title}</p>
                  <PriorityPill priority={risk.priority} />
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{risk.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无风险" description="执行中发现的阻塞项会同步到这里。" />
        )}
      </MobileSection>
    </MobilePage>
  );
}
