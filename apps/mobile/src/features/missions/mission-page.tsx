import { ArrowLeft, ArrowUpRight, MessageSquarePlus } from "lucide-react";
import { demoMissions } from "../../fixtures/mobile-demo-data";
import type { Mission, MissionAction, RiskItem } from "../../types";
import {
  ActionButton,
  EmptyState,
  MissionControlIcon,
  MissionStatusPill,
  MobilePage,
  MobileSection,
  PriorityPill,
  RiskIcon,
  TimelineIcon,
} from "../../components";

const defaultActions: MissionAction[] = [
  { id: "pause", label: "暂停", intent: "neutral" },
  { id: "resume", label: "继续", intent: "primary" },
  { id: "abort", label: "中断", intent: "danger" },
];

interface MissionPageProps {
  missions?: Mission[];
  selectedMission?: Mission;
  risks?: RiskItem[];
  actions?: MissionAction[];
  onOpenMission?: (missionId: string) => void;
  onBackToList?: () => void;
  onOpenRisk?: (riskId: string) => void;
  onAction?: (actionId: MissionAction["id"], missionId: string) => void;
  onSubmitContext?: (missionId: string) => void;
}

export function MissionPage({
  missions = demoMissions,
  selectedMission,
  risks = [],
  actions = defaultActions,
  onOpenMission,
  onBackToList,
  onOpenRisk,
  onAction,
  onSubmitContext,
}: MissionPageProps) {
  if (selectedMission) {
    return (
      <MissionDetail
        mission={selectedMission}
        actions={actions}
        onBackToList={onBackToList}
        onAction={onAction}
        onSubmitContext={onSubmitContext}
      />
    );
  }

  const activeMissions = missions.filter(
    (mission) => mission.status === "running" || mission.status === "waiting",
  );
  const otherMissions = missions.filter(
    (mission) => mission.status !== "running" && mission.status !== "waiting",
  );

  return (
    <MobilePage title="Mission" subtitle="跟进执行进度，处理需要拍板的风险。">
      <MobileSection title="正在执行" meta={`${activeMissions.length} 个 Mission`}>
        {activeMissions.length > 0 ? (
          <div className="flex flex-col gap-2">
            {activeMissions.map((mission) => (
              <MissionCard
                key={mission.id}
                mission={mission}
                onOpen={() => onOpenMission?.(mission.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="暂无执行中的 Mission"
            description="从想法池升级一个想法，就会出现在这里。"
          />
        )}
      </MobileSection>

      {risks.length > 0 ? (
        <MobileSection title="需要确认" meta={`${risks.length} 个风险 / 决策点`}>
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
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {risk.description}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {risk.source}
                    {risk.dueLabel ? ` · ${risk.dueLabel}` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </MobileSection>
      ) : null}

      {otherMissions.length > 0 ? (
        <MobileSection title="其他 Mission" meta={`${otherMissions.length} 个`}>
          <div className="flex flex-col gap-2">
            {otherMissions.map((mission) => (
              <MissionCard
                key={mission.id}
                mission={mission}
                onOpen={() => onOpenMission?.(mission.id)}
              />
            ))}
          </div>
        </MobileSection>
      ) : null}
    </MobilePage>
  );
}

function MissionCard({ mission, onOpen }: { mission: Mission; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg border border-border bg-background p-3 text-left transition active:bg-muted"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-1 text-sm font-semibold">{mission.title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {mission.summary}
          </p>
        </div>
        <MissionStatusPill status={mission.status} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${mission.progress}%` }}
          />
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
  );
}

interface MissionDetailProps {
  mission: Mission;
  actions: MissionAction[];
  onBackToList?: () => void;
  onAction?: (actionId: MissionAction["id"], missionId: string) => void;
  onSubmitContext?: (missionId: string) => void;
}

function MissionDetail({
  mission,
  actions,
  onBackToList,
  onAction,
  onSubmitContext,
}: MissionDetailProps) {
  return (
    <MobilePage
      title={mission.title}
      subtitle={mission.summary}
      rightSlot={<MissionStatusPill status={mission.status} />}
      leftSlot={
        onBackToList ? (
          <button
            type="button"
            onClick={onBackToList}
            className="flex size-9 items-center justify-center rounded-lg border border-border bg-background active:bg-muted"
            aria-label="返回 Mission 列表"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : null
      }
    >
      <MobileSection
        title="进度"
        meta={`开始 ${mission.startedAtLabel} · ETA ${mission.etaLabel}`}
      >
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="line-clamp-1 text-xs text-muted-foreground">{mission.currentStep}</p>
            </div>
            <span className="text-2xl font-semibold tabular-nums">{mission.progress}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${mission.progress}%` }}
            />
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
                {index < mission.timeline.length - 1 ? (
                  <div className="mt-1 h-full w-px bg-border" />
                ) : null}
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

      {mission.risks.length > 0 ? (
        <MobileSection title="关联风险" meta={`${mission.risks.length} 个`}>
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
        </MobileSection>
      ) : null}
    </MobilePage>
  );
}
