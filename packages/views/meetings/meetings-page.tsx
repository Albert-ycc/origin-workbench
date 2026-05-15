"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ListChecks,
  MessageSquareText,
  Mic,
  Plus,
  Send,
  Square,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  meetingDetailOptions,
  meetingInsightOptions,
  meetingListOptions,
  meetingTranscriptOptions,
  useCreateMeetingSession,
  useCreateMeetingTranscriptSegment,
  useStartMeetingSession,
  useStopMeetingSession,
  useUpdateMeetingInsightStatus,
  useUpdateMeetingSession,
} from "@multica/core/meetings";
import { projectV12DetailOptions } from "@multica/core/projects-v12";
import type { MeetingInsightCard, MeetingSession } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Switch } from "@multica/ui/components/ui/switch";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { PageHeader } from "../layout/page-header";
import { useNavigation } from "../navigation";
import { useLiveTranscription } from "./live-transcription";

export function MeetingsPage({
  projectId,
  meetingId,
}: {
  projectId: string;
  meetingId?: string;
}) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const { data: project } = useQuery(projectV12DetailOptions(wsId, projectId));
  const { data: meetingPage, isLoading } = useQuery(meetingListOptions(wsId, projectId));
  const meetings = meetingPage?.meetings ?? [];
  const activeId = meetingId ?? meetings[0]?.id ?? "";
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <aside className="flex w-[260px] shrink-0 flex-col border-r">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Mic className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">会议</span>
          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0"
            onClick={() => setCreating(true)}
            title="新建会议"
          >
            <Plus className="size-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="space-y-2 p-1">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-md" />
              ))}
            </div>
          ) : meetings.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <Mic className="mx-auto mb-2 size-7 text-muted-foreground opacity-50" />
              <p className="mb-3 text-xs text-muted-foreground">还没有会议</p>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" />
                新建会议
              </Button>
            </div>
          ) : (
            <ul className="space-y-1">
              {meetings.map((meeting) => (
                <li key={meeting.id}>
                  <button
                    type="button"
                    onClick={() => navigation.push(paths.projectMeetingDetail(projectId, meeting.id))}
                    className={cn(
                      "w-full rounded-md px-2 py-2 text-left transition-colors",
                      meeting.id === activeId ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {meeting.title}
                      </span>
                      <StatusBadge status={meeting.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{meeting.user_role || "未设参会方向"}</span>
                      {meeting.sound_enabled ? (
                        <Volume2 className="size-3 shrink-0" />
                      ) : (
                        <VolumeX className="size-3 shrink-0" />
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader className="gap-2 px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="hidden shrink-0 text-sm text-muted-foreground lg:inline">
              {project?.title ?? "项目"} /
            </span>
            <span className="min-w-0 truncate text-sm font-medium">会议 Copilot</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigation.push(paths.projectWorkspaceDetail(projectId))}
          >
            返回项目
          </Button>
        </PageHeader>
        {activeId ? (
          <MeetingSessionView meetingId={activeId} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <MessageSquareText className="size-10 text-muted-foreground opacity-50" />
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              新建会议
            </Button>
          </div>
        )}
      </main>

      {creating && (
        <CreateMeetingDialog
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(id) => navigation.push(paths.projectMeetingDetail(projectId, id))}
        />
      )}
    </div>
  );
}

function MeetingSessionView({ meetingId }: { meetingId: string }) {
  const wsId = useWorkspaceId();
  const { data: meeting, isLoading } = useQuery(meetingDetailOptions(wsId, meetingId));
  const { data: transcriptPage } = useQuery(meetingTranscriptOptions(wsId, meetingId));
  const { data: insightPage } = useQuery(meetingInsightOptions(wsId, meetingId));
  const startMeeting = useStartMeetingSession(wsId);
  const stopMeeting = useStopMeetingSession(wsId);
  const updateMeeting = useUpdateMeetingSession(wsId);
  const addSegment = useCreateMeetingTranscriptSegment(wsId);
  const updateInsight = useUpdateMeetingInsightStatus(wsId);
  const [draft, setDraft] = useState("");
  const segments = transcriptPage?.segments ?? [];
  const nextSeqRef = useRef(0);
  const cards = insightPage?.cards ?? [];
  const seenStrongAlertIdsRef = useRef<Set<string>>(new Set());
  const initializedStrongAlertsRef = useRef(false);
  const [activeStrongAlertId, setActiveStrongAlertId] = useState<string | null>(null);
  const strongAlerts = useMemo(
    () => cards.filter((card) => card.status === "open" && (card.severity === "L2" || card.severity === "L3")),
    [cards],
  );
  const activeStrongAlert =
    strongAlerts.find((card) => card.id === activeStrongAlertId) ?? strongAlerts[0] ?? null;

  useEffect(() => {
    nextSeqRef.current = Math.max(nextSeqRef.current, segments.at(-1)?.seq ?? 0);
  }, [segments]);

  const createTranscriptSegment = useCallback(
    async (text: string, source: "renderer" | "manual" = "renderer") => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const seq = nextSeqRef.current + 1;
      nextSeqRef.current = seq;
      try {
        await addSegment.mutateAsync({
          meetingId,
          data: {
            seq,
            text: trimmed,
            speaker_label: source === "renderer" ? "实时转写" : "现场",
            source,
            confidence: source === "renderer" ? 0.8 : 1,
          },
        });
      } catch (error) {
        nextSeqRef.current = Math.max(0, nextSeqRef.current - 1);
        toast.error(error instanceof Error ? error.message : "追加转写失败");
      }
    },
    [addSegment, meetingId],
  );

  const liveTranscription = useLiveTranscription({
    onFinalTranscript: (text) => createTranscriptSegment(text, "renderer"),
  });

  useEffect(() => {
    if (meeting?.status !== "running" && liveTranscription.isListening) {
      liveTranscription.stop();
    }
  }, [liveTranscription, meeting?.status]);

  useEffect(() => {
    if (!meeting) return;
    const currentIds = new Set(strongAlerts.map((card) => card.id));
    if (!initializedStrongAlertsRef.current) {
      seenStrongAlertIdsRef.current = currentIds;
      initializedStrongAlertsRef.current = true;
      setActiveStrongAlertId(strongAlerts[0]?.id ?? null);
      return;
    }

    const nextNewAlert = strongAlerts.find((card) => !seenStrongAlertIdsRef.current.has(card.id));
    seenStrongAlertIdsRef.current = currentIds;
    if (nextNewAlert) {
      setActiveStrongAlertId(nextNewAlert.id);
      if (meeting.sound_enabled) playMeetingAlertSound();
      return;
    }

    setActiveStrongAlertId((current) => {
      if (!current) return strongAlerts[0]?.id ?? null;
      return currentIds.has(current) ? current : strongAlerts[0]?.id ?? null;
    });
  }, [meeting, strongAlerts]);

  if (isLoading || !meeting) {
    return (
      <div className="flex flex-1 gap-3 p-3">
        <Skeleton className="flex-1" />
        <Skeleton className="flex-1" />
        <Skeleton className="w-[320px]" />
      </div>
    );
  }

  const submitSegment = async () => {
    const text = draft.trim();
    if (!text) return;
    await createTranscriptSegment(text, "manual");
    setDraft("");
  };

  const startSession = async () => {
    try {
      await startMeeting.mutateAsync(meeting.id);
      if (meeting.asr_provider === "renderer") {
        const ok = await liveTranscription.start();
        if (!ok) toast.error("实时转写不可用，已保留手动追加");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "会议启动失败");
    }
  };

  const stopSession = async () => {
    liveTranscription.stop();
    try {
      await stopMeeting.mutateAsync(meeting.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "会议结束失败");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{meeting.title}</span>
            <StatusBadge status={meeting.status} />
            <Badge variant="secondary" className="shrink-0">
              {analysisCopy[meeting.analysis_status] ?? meeting.analysis_status}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {meeting.sound_enabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          <Switch
            checked={meeting.sound_enabled}
            onCheckedChange={(checked) =>
              updateMeeting.mutate({ id: meeting.id, data: { sound_enabled: checked } })
            }
            aria-label="提示音"
          />
        </div>
        <Badge variant="outline" className="shrink-0">
          {transcriptionStatusCopy[liveTranscription.status] ?? liveTranscription.status}
        </Badge>
        {meeting.status === "running" ? (
          <Button size="sm" variant="outline" onClick={stopSession}>
            <Square className="size-4" />
            结束
          </Button>
        ) : (
          <Button size="sm" onClick={startSession}>
            <Play className="size-4" />
            开始
          </Button>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.95fr)_minmax(300px,1.05fr)_320px] overflow-hidden">
        <section className="flex min-h-0 flex-col border-r">
          <PanelTitle icon={MessageSquareText} title="同步转写" count={segments.length} />
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {segments.length === 0 ? (
              <EmptyLine text="暂无转写" />
            ) : (
              <div className="space-y-2">
                {segments.map((segment) => (
                  <div key={segment.id} className="rounded-md border bg-background px-3 py-2">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{segment.speaker_label || "现场"}</span>
                      <span>#{segment.seq}</span>
                    </div>
                    <p className="text-sm leading-6">{segment.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="border-t p-3">
            {liveTranscription.error && (
              <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600">
                {liveTranscription.error}
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={2}
                placeholder="追加一段转写"
                className="min-h-[56px] resize-none text-sm"
              />
              <Button
                size="icon"
                className="h-[56px] w-10 shrink-0"
                onClick={submitSegment}
                disabled={!draft.trim() || addSegment.isPending}
                title="发送"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col border-r">
          <PanelTitle icon={ListChecks} title="Agent 分析" count={cards.length} />
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {cards.length === 0 ? (
              <EmptyLine text="暂无洞察" />
            ) : (
              <div className="space-y-2">
                {cards.map((card) => (
                  <InsightRow
                    key={card.id}
                    card={card}
                    onResolve={(status) =>
                      updateInsight.mutate({ meetingId, insightId: card.id, status })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col bg-muted/20">
          <PanelTitle icon={Bell} title="强提醒" count={strongAlerts.length} />
          {activeStrongAlert && (
            <ActiveStrongAlertBanner
              card={activeStrongAlert}
              soundEnabled={meeting.sound_enabled}
              onDone={() =>
                updateInsight.mutate({ meetingId, insightId: activeStrongAlert.id, status: "asked" })
              }
              onCollapse={() => {
                const fallback = strongAlerts.find((card) => card.id !== activeStrongAlert.id);
                setActiveStrongAlertId(fallback?.id ?? null);
              }}
            />
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {strongAlerts.length === 0 ? (
              <EmptyLine text="暂无强提醒" />
            ) : (
              <div className="space-y-2">
                {strongAlerts.map((card) => (
                  <StrongAlert
                    key={card.id}
                    card={card}
                    soundEnabled={meeting.sound_enabled}
                    onDone={() =>
                      updateInsight.mutate({ meetingId, insightId: card.id, status: "asked" })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function CreateMeetingDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const wsId = useWorkspaceId();
  const createMeeting = useCreateMeetingSession(wsId);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [userRole, setUserRole] = useState("");
  const [focus, setFocus] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [analysisEnabled, setAnalysisEnabled] = useState(true);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("先填写会议标题");
      return;
    }
    try {
      const meeting = await createMeeting.mutateAsync({
        project_id: projectId,
        title: title.trim(),
        goal: goal.trim(),
        user_role: userRole.trim(),
        sound_enabled: soundEnabled,
        reminder_mode: "strong",
        reminder_intensity: "standard",
        model_source: analysisEnabled ? "local" : "not_configured",
        analysis_enabled: analysisEnabled,
        strategy: {
          focus: focus
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
        },
      });
      onClose();
      onCreated(meeting.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建会议失败");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>新建会议</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="meeting-title" className="text-xs">标题</Label>
            <Input
              id="meeting-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="客户需求评审"
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-goal" className="text-xs">目标</Label>
            <Textarea
              id="meeting-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="这场会要拿到什么结论"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-role" className="text-xs">参会方向</Label>
            <Input
              id="meeting-role"
              value={userRole}
              onChange={(event) => setUserRole(event.target.value)}
              placeholder="产品负责人 / 销售 / 技术负责人"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-focus" className="text-xs">关注点</Label>
            <Textarea
              id="meeting-focus"
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              placeholder={"上线范围\n预算风险\n客户反馈"}
              rows={3}
            />
          </div>
          <label className="flex items-center justify-between rounded-md border px-3 py-2">
            <span className="text-sm">提示音</span>
            <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
          </label>
          <label className="flex items-center justify-between rounded-md border px-3 py-2">
            <span className="text-sm">Agent 同步分析</span>
            <Switch checked={analysisEnabled} onCheckedChange={setAnalysisEnabled} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={createMeeting.isPending}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InsightRow({
  card,
  onResolve,
}: {
  card: MeetingInsightCard;
  onResolve: (status: "asked" | "ignored") => void;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center gap-2">
        <InsightTypeBadge type={card.type} />
        <SeverityBadge severity={card.severity} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{card.title}</span>
      </div>
      {card.reason && <p className="text-sm leading-6 text-muted-foreground">{card.reason}</p>}
      {card.evidence_quote && (
        <blockquote className="mt-2 border-l-2 pl-2 text-xs text-muted-foreground">
          {card.evidence_quote}
        </blockquote>
      )}
      {card.status === "open" && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => onResolve("ignored")}>
            忽略
          </Button>
          <Button size="sm" variant="outline" onClick={() => onResolve("asked")}>
            <CheckCircle2 className="size-4" />
            已处理
          </Button>
        </div>
      )}
    </div>
  );
}

function ActiveStrongAlertBanner({
  card,
  soundEnabled,
  onDone,
  onCollapse,
}: {
  card: MeetingInsightCard;
  soundEnabled: boolean;
  onDone: () => void;
  onCollapse: () => void;
}) {
  return (
    <div
      className={cn(
        "m-3 mb-0 rounded-md border p-3 shadow-lg ring-2 ring-offset-2 ring-offset-background motion-safe:animate-pulse",
        card.severity === "L3"
          ? "border-red-500 bg-red-500/15 ring-red-500/30"
          : "border-amber-500 bg-amber-500/15 ring-amber-500/30",
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <Bell
          className={cn(
            "mt-0.5 size-5 shrink-0",
            card.severity === "L3" ? "text-red-500" : "text-amber-500",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-muted-foreground">
            {card.severity === "L3" ? "高优先级强提醒" : "强提醒"}
          </div>
          <div className="line-clamp-2 text-sm font-semibold leading-5">{card.title}</div>
        </div>
        <SeverityBadge severity={card.severity} />
      </div>
      {card.suggested_question && (
        <p className="rounded-md bg-background/80 px-2 py-1.5 text-sm leading-6">
          {card.suggested_question}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {soundEnabled ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
          {soundEnabled ? "提示音开启" : "默认静音"}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCollapse}>
            收起
          </Button>
          <Button size="sm" onClick={onDone}>
            <CheckCircle2 className="size-4" />
            已提醒
          </Button>
        </div>
      </div>
    </div>
  );
}

function StrongAlert({
  card,
  soundEnabled,
  onDone,
}: {
  card: MeetingInsightCard;
  soundEnabled: boolean;
  onDone: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 shadow-sm",
        card.severity === "L3"
          ? "border-red-500/70 bg-red-500/10"
          : "border-amber-500/70 bg-amber-500/10",
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <AlertTriangle className={cn("mt-0.5 size-4", card.severity === "L3" ? "text-red-500" : "text-amber-500")} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{card.title}</div>
          <div className="text-[11px] text-muted-foreground">
            {soundEnabled ? "提示音开启" : "静音"}
          </div>
        </div>
      </div>
      {card.suggested_question && (
        <p className="rounded-md bg-background/70 px-2 py-1.5 text-sm leading-6">
          {card.suggested_question}
        </p>
      )}
      {card.evidence_quote && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{card.evidence_quote}</p>
      )}
      <Button className="mt-3 w-full" size="sm" onClick={onDone}>
        <CheckCircle2 className="size-4" />
        已提醒
      </Button>
    </div>
  );
}

function PanelTitle({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof Mic;
  title: string;
  count: number;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
      <Icon className="size-4 text-muted-foreground" />
      <span className="text-xs font-medium">{title}</span>
      <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
        {count}
      </Badge>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[160px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function StatusBadge({ status }: { status: MeetingSession["status"] }) {
  return (
    <Badge variant="secondary" className={cn("shrink-0", statusTone[status])}>
      {statusCopy[status] ?? status}
    </Badge>
  );
}

function InsightTypeBadge({ type }: { type: MeetingInsightCard["type"] }) {
  return (
    <Badge variant="outline" className="shrink-0">
      {typeCopy[type] ?? type}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: MeetingInsightCard["severity"] }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "shrink-0",
        severity === "L3" && "bg-red-500/15 text-red-500",
        severity === "L2" && "bg-amber-500/15 text-amber-500",
        severity === "L1" && "bg-muted text-muted-foreground",
      )}
    >
      {severity}
    </Badge>
  );
}

const statusCopy: Record<MeetingSession["status"], string> = {
  draft: "草稿",
  running: "进行中",
  stopped: "已结束",
  summarizing: "总结中",
  completed: "完成",
  archived: "归档",
};

const statusTone: Record<MeetingSession["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  running: "bg-emerald-500/15 text-emerald-500",
  stopped: "bg-amber-500/15 text-amber-500",
  summarizing: "bg-blue-500/15 text-blue-500",
  completed: "bg-blue-500/15 text-blue-500",
  archived: "bg-muted text-muted-foreground",
};

const analysisCopy: Record<string, string> = {
  idle: "待分析",
  running: "分析中",
  paused: "仅转写",
  failed: "分析失败",
  completed: "分析完成",
};

const transcriptionStatusCopy: Record<string, string> = {
  idle: "手动转写",
  requesting: "请求麦克风",
  listening: "实时转写中",
  unsupported: "手动转写",
  error: "转写异常",
};

const typeCopy: Record<MeetingInsightCard["type"], string> = {
  question: "问题",
  risk: "风险",
  feedback: "反馈",
  tension: "既要",
  summary: "摘要",
};

function playMeetingAlertSound() {
  if (typeof window === "undefined") return;
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const audioContext = new AudioContextCtor();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.22);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.24);
  oscillator.addEventListener("ended", () => void audioContext.close());
}
