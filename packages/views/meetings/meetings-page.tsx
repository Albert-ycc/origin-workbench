"use client";

import type { ChangeEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  Bell,
  Bot,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Merge,
  MessageSquareText,
  Mic,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  meetingDetailOptions,
  meetingASRJobOptions,
  meetingASRStatusOptions,
  meetingAudioAssetOptions,
  meetingInsightOptions,
  meetingListOptions,
  meetingSummaryOptions,
  meetingTranscriptOptions,
  useArchiveMeetingSession,
  useCreateMeetingASRJob,
  useCreateMeetingSession,
  useCreateMeetingTranscriptSegment,
  useDeleteMeetingAudioAsset,
  useDeleteMeetingSession,
  useDeleteMeetingTranscriptSegment,
  useGenerateMeetingSummary,
  useMergeMeetingTranscriptSegments,
  useRetryMeetingASRJob,
  useSaveMeetingAudioAsset,
  useSplitMeetingTranscriptSegment,
  useStartMeetingSession,
  useStopMeetingSession,
  useUpdateMeetingTranscriptSegment,
  useUpdateMeetingInsightStatus,
  useUpdateMeetingSession,
} from "@multica/core/meetings";
import { projectV12ListOptions } from "@multica/core/projects-v12";
import type {
  MeetingASRJob,
  MeetingASRJobStatus,
  MeetingASRProvider,
  MeetingASRStatus,
  MeetingAudioAsset,
  MeetingInsightCard,
  MeetingSession,
  MeetingSummary,
  MeetingTranscriptSegment,
  ProjectV12,
} from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Switch } from "@multica/ui/components/ui/switch";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { PageHeader } from "../layout/page-header";
import { useNavigation } from "../navigation";
import {
  buildMeetingAudioFileName,
  type MeetingAudioRecorderController,
  useMeetingAudioRecorder,
} from "./audio-recorder";
import { type LiveTranscriptionStatus, useLiveTranscription } from "./live-transcription";

const EMPTY_PROJECTS: ProjectV12[] = [];

export const meetingPrimarySurfaces = ["实时转写流", "关键洞察 / 旁听提示"] as const;
export const meetingBackupSurfaces = ["临时录音"] as const;

export const meetingNavigationCopy = {
  routeTitle: "会议",
  globalTitle: "会议工作台",
  projectTitle: "项目会议",
  capabilitySubtitle: "会议 Copilot 能力用于录音转写、Agent 旁听分析和会后沉淀",
} as const;

export const meetingPrimaryActions = ["开始", "结束"] as const;

export const meetingSecondaryActions = ["会议设置", "导入转写", "纪要生成 / 查看"] as const;

export const meetingDangerActions = ["归档", "删除"] as const;

export const meetingDangerConfirmations = {
  meetingDelete: "alert-dialog",
} as const;

export function meetingTranscriptionAsideCopy(
  provider: MeetingASRProvider,
  liveStatus: LiveTranscriptionStatus,
): string {
  if (provider === "manual") return "手动记录";
  if (provider === "external") return "外部转写待接入";
  if (provider === "local") return "录音保存后转写";
  return transcriptionStatusCopy[liveStatus] ?? "待启动";
}

type MeetingTemplate = {
  id: string;
  label: string;
  title: string;
  goal: string;
  role: string;
  focus: string[];
};

const DEFAULT_MEETING_TEMPLATE: MeetingTemplate = {
  id: "daily",
  label: "即时沟通",
  title: "即时沟通会",
  goal: "快速同步现状、识别阻塞、明确下一步。",
  role: "会议发起人",
  focus: ["问题澄清", "阻塞风险", "行动项"],
};

const MEETING_TEMPLATES: MeetingTemplate[] = [
  DEFAULT_MEETING_TEMPLATE,
  {
    id: "review",
    label: "需求评审",
    title: "需求评审会",
    goal: "确认需求范围、风险边界和验收口径。",
    role: "产品负责人",
    focus: ["范围变更", "验收标准", "技术风险"],
  },
  {
    id: "customer",
    label: "客户访谈",
    title: "客户访谈",
    goal: "沉淀用户反馈、真实场景和后续跟进事项。",
    role: "访谈主持人",
    focus: ["用户反馈", "痛点证据", "项目记忆"],
  },
  {
    id: "retro",
    label: "复盘决策",
    title: "项目复盘会",
    goal: "归纳决策依据、遗留风险和复盘行动项。",
    role: "项目负责人",
    focus: ["关键决策", "风险复盘", "负责人"],
  },
];

export function MeetingsPage({
  projectId,
  meetingId,
}: {
  projectId?: string;
  meetingId?: string;
}) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const { data: projects = EMPTY_PROJECTS, isLoading: projectsLoading } =
    useQuery(projectV12ListOptions(wsId));
  const [projectFilter, setProjectFilter] = useState(projectId ?? "all");
  const [creatingTemplate, setCreatingTemplate] = useState<MeetingTemplate | null>(null);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const scopedProjectId = projectId ?? (projectFilter === "all" ? null : projectFilter);
  const { data: meetingPage, isLoading } = useQuery(meetingListOptions(wsId, scopedProjectId));
  const meetings = meetingPage?.meetings ?? [];
  const activeId = meetingId ?? meetings[0]?.id ?? "";
  const isProjectScoped = Boolean(projectId);
  const project = projectId ? projectById.get(projectId) : undefined;

  useEffect(() => {
    if (projectId) setProjectFilter(projectId);
  }, [projectId]);

  const openMeeting = (meeting: MeetingSession) => {
    navigation.push(
      projectId
        ? paths.projectMeetingDetail(projectId, meeting.id)
        : paths.meetingDetail(meeting.id),
    );
  };

  const openCreate = (template: MeetingTemplate = DEFAULT_MEETING_TEMPLATE) => {
    setCreatingTemplate(template);
  };

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <aside className="flex w-[320px] shrink-0 flex-col border-r bg-muted/20">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <Mic className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">会议工作台</div>
            <div className="truncate text-[11px] text-muted-foreground">
              快速发起、转写、旁听分析
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => openCreate()}
            title="新建会议"
          >
            <Plus className="size-4" />
          </Button>
        </header>
        {!isProjectScoped && (
          <div className="border-b p-3">
            <Select
              value={projectFilter}
              onValueChange={(value) => setProjectFilter(value ?? "all")}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="全部项目" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部项目</SelectItem>
                {projects.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-md" />
              ))}
            </div>
          ) : meetings.length === 0 ? (
            <EmptyState
              icon={Mic}
              title="还没有会议"
              description="先选一个会议类型，会议会自动关联到项目。"
              action={
                <Button size="sm" onClick={() => openCreate()}>
                  <Plus className="size-4" />
                  新建会议
                </Button>
              }
            />
          ) : (
            <div className="space-y-1">
              {meetings.map((meeting) => (
                <MeetingListItem
                  key={meeting.id}
                  meeting={meeting}
                  active={meeting.id === activeId}
                  projectTitle={projectById.get(meeting.project_id)?.title}
                  projectScoped={isProjectScoped}
                  onClick={() => openMeeting(meeting)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader className="h-14 gap-3 px-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold">
                {isProjectScoped ? project?.title ?? meetingNavigationCopy.projectTitle : meetingNavigationCopy.globalTitle}
              </span>
              <Badge variant="secondary" className="shrink-0">
                {isProjectScoped ? "项目会议" : "全部会议"}
              </Badge>
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {meetingNavigationCopy.capabilitySubtitle}
            </div>
          </div>
          {projectId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigation.push(paths.projectWorkspaceDetail(projectId))}
            >
              返回项目
            </Button>
          )}
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="size-4" />
            新建会议
          </Button>
        </PageHeader>

        <QuickLaunchStrip
          templates={MEETING_TEMPLATES}
          disabled={!projectId && projects.length === 0}
          onSelect={openCreate}
        />

        {activeId ? (
          <MeetingSessionView
            meetingId={activeId}
            projectId={projectId}
            projects={projects}
            projectById={projectById}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8">
            <EmptyState
              icon={MessageSquareText}
              title="选择或新建一场会议"
              description="会议内容会沉淀在所属项目里，结束后可生成纪要。"
              action={
                <Button onClick={() => openCreate()}>
                  <Plus className="size-4" />
                  新建会议
                </Button>
              }
            />
          </div>
        )}
      </main>

      {creatingTemplate && (
        <CreateMeetingDialog
          projectId={projectId}
          defaultProjectId={scopedProjectId ?? undefined}
          template={creatingTemplate}
          projects={projects}
          projectsLoading={projectsLoading}
          onClose={() => setCreatingTemplate(null)}
          onCreated={(meeting) =>
            navigation.push(
              projectId
                ? paths.projectMeetingDetail(projectId, meeting.id)
                : paths.meetingDetail(meeting.id),
            )
          }
        />
      )}
    </div>
  );
}

function MeetingSessionView({
  meetingId,
  projectId,
  projects,
  projectById,
}: {
  meetingId: string;
  projectId?: string;
  projects: ProjectV12[];
  projectById: Map<string, ProjectV12>;
}) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const { data: meeting, isLoading } = useQuery(meetingDetailOptions(wsId, meetingId));
  const { data: transcriptPage } = useQuery(meetingTranscriptOptions(wsId, meetingId));
  const { data: insightPage } = useQuery(meetingInsightOptions(wsId, meetingId));
  const { data: summary } = useQuery(meetingSummaryOptions(wsId, meetingId));
  const { data: audioAssetsPage } = useQuery(meetingAudioAssetOptions(wsId, meetingId));
  const { data: asrJobsPage } = useQuery(meetingASRJobOptions(wsId, meetingId));
  const startMeeting = useStartMeetingSession(wsId);
  const stopMeeting = useStopMeetingSession(wsId);
  const archiveMeeting = useArchiveMeetingSession(wsId);
  const deleteMeeting = useDeleteMeetingSession(wsId);
  const updateMeeting = useUpdateMeetingSession(wsId);
  const addSegment = useCreateMeetingTranscriptSegment(wsId);
  const updateSegment = useUpdateMeetingTranscriptSegment(wsId);
  const deleteSegment = useDeleteMeetingTranscriptSegment(wsId);
  const splitSegment = useSplitMeetingTranscriptSegment(wsId);
  const mergeSegment = useMergeMeetingTranscriptSegments(wsId);
  const updateInsight = useUpdateMeetingInsightStatus(wsId);
  const generateSummary = useGenerateMeetingSummary(wsId);
  const saveAudioAsset = useSaveMeetingAudioAsset(wsId);
  const deleteAudioAsset = useDeleteMeetingAudioAsset(wsId);
  const createASRJob = useCreateMeetingASRJob(wsId);
  const retryASRJob = useRetryMeetingASRJob(wsId);
  const audioRecorder = useMeetingAudioRecorder();
  const audioRecordingState = audioRecorder.state;
  const stopAudioRecording = audioRecorder.stop;
  const resetAudioRecording = audioRecorder.reset;
  const [draft, setDraft] = useState("");
  const [importText, setImportText] = useState("");
  const [manualFallbackMeetingId, setManualFallbackMeetingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [savedRecordingAssetId, setSavedRecordingAssetId] = useState<string | null>(null);
  const [activeASRJobId, setActiveASRJobId] = useState<string | null>(null);
  const [highlightedTranscriptSeq, setHighlightedTranscriptSeq] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const segments = transcriptPage?.segments ?? [];
  const cards = insightPage?.cards ?? [];
  const audioAssets = audioAssetsPage?.assets ?? [];
  const asrJobs = asrJobsPage?.jobs ?? [];
  const seenStrongAlertIdsRef = useRef<Set<string>>(new Set());
  const initializedStrongAlertsRef = useRef(false);
  const autoStartAttemptedMeetingIdRef = useRef<string | null>(null);
  const [activeStrongAlertId, setActiveStrongAlertId] = useState<string | null>(null);
  const strongAlerts = useMemo(
    () => cards.filter((card) => card.status === "open" && (card.severity === "L2" || card.severity === "L3")),
    [cards],
  );
  const activeStrongAlert =
    strongAlerts.find((card) => card.id === activeStrongAlertId) ?? strongAlerts[0] ?? null;
  const savedRecordingAsset = savedRecordingAssetId
    ? audioAssets.find((asset) => asset.id === savedRecordingAssetId)
    : null;
  const activeASRJob = activeASRJobId
    ? asrJobs.find((job) => job.id === activeASRJobId)
    : asrJobs[0] ?? null;

  useEffect(() => {
    setSavedRecordingAssetId(null);
    setActiveASRJobId(null);
  }, [audioRecorder.recording?.url]);

  useEffect(() => {
    if (!highlightedTranscriptSeq || typeof document === "undefined") return;
    const element = document.getElementById(transcriptSegmentDomId(highlightedTranscriptSeq));
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedTranscriptSeq]);

  const createTranscriptSegment = useCallback(
    async (
      text: string,
      source: MeetingASRProvider = "renderer",
      speakerLabel = source === "renderer" ? "实时转写" : "现场",
    ): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      try {
        await addSegment.mutateAsync({
          meetingId,
          data: {
            text: trimmed,
            speaker_label: speakerLabel,
            source,
            confidence: source === "renderer" ? 0.8 : 1,
          },
        });
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存转写失败");
        return false;
      }
    },
    [addSegment, meetingId],
  );

  const liveTranscription = useLiveTranscription({
    onFinalTranscript: async (text) => {
      await createTranscriptSegment(text, "renderer");
    },
  });

  const saveRecordingToMeeting = async () => {
    const recording = audioRecorder.recording;
    if (!recording || !meeting) return;
    const filename = buildMeetingAudioFileName(meeting.title, recording.startedAt, recording.mimeType);
    const file = new File([recording.blob], filename, {
      type: recording.mimeType,
      lastModified: recording.startedAt.getTime(),
    });
    try {
      const asset = await saveAudioAsset.mutateAsync({
        meetingId: meeting.id,
        data: {
          file,
          duration_seconds: recording.durationSeconds,
        },
      });
      setSavedRecordingAssetId(asset.id);
      const provider = meeting.asr_provider === "external" ? "external" : "local";
      const job = await createASRJob.mutateAsync({
        meetingId: meeting.id,
        audioAssetId: asset.id,
        data: { provider },
      });
      setActiveASRJobId(job.id);
      if (job.status === "failed") {
        toast.message("录音已保存到会议，自动转写暂不可用");
      } else {
        toast.success("录音已保存到会议，转写任务已在后台执行");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "录音保存或转写任务创建失败");
    }
  };

  const retryActiveASRJob = async () => {
    if (!meeting || !activeASRJob) return;
    await retryMeetingASRJobById(activeASRJob.id);
  };

  const retryMeetingASRJobById = async (jobId: string) => {
    if (!meeting) return;
    try {
      const job = await retryASRJob.mutateAsync({ meetingId: meeting.id, jobId });
      setActiveASRJobId(job.id);
      if (job.status === "failed") {
        toast.message("转写重试失败，仍可手动导入转写");
      } else {
        toast.success("转写任务已重试");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "转写重试失败");
    }
  };

  const deleteAudioAssetById = async (assetId: string) => {
    if (!meeting) return;
    try {
      await deleteAudioAsset.mutateAsync({ meetingId: meeting.id, assetId });
      if (savedRecordingAssetId === assetId) {
        setSavedRecordingAssetId(null);
      }
      toast.success("录音已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除录音失败");
    }
  };

  useEffect(() => {
    if (meeting?.status !== "running" && audioRecordingState === "recording") {
      stopAudioRecording();
    }
  }, [audioRecordingState, meeting?.status, stopAudioRecording]);

  const switchToManualTranscription = useCallback(
    async (targetMeeting: MeetingSession, message = "实时转写不可用，已切到手动记录") => {
      liveTranscription.reset();
      setManualFallbackMeetingId(targetMeeting.id);
      try {
        await updateMeeting.mutateAsync({
          id: targetMeeting.id,
          data: { asr_provider: "manual" },
        });
        toast.message(message);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "切换手动记录失败");
      }
    },
    [liveTranscription.reset, updateMeeting],
  );

  useEffect(() => {
    if (meeting?.status !== "running" && liveTranscription.isListening) {
      liveTranscription.stop();
    }
  }, [liveTranscription.isListening, liveTranscription.stop, meeting?.status]);

  useEffect(() => {
    autoStartAttemptedMeetingIdRef.current = null;
    setManualFallbackMeetingId(null);
    seenStrongAlertIdsRef.current = new Set();
    initializedStrongAlertsRef.current = false;
    setActiveStrongAlertId(null);
    liveTranscription.reset();
    resetAudioRecording();
  }, [liveTranscription.reset, meetingId, resetAudioRecording]);

  useEffect(() => {
    if (!meeting) {
      autoStartAttemptedMeetingIdRef.current = null;
      return;
    }
    const currentASRProvider =
      manualFallbackMeetingId === meeting.id ? "manual" : meeting.asr_provider;
    if (meeting.status !== "running" || currentASRProvider !== "renderer") {
      autoStartAttemptedMeetingIdRef.current = null;
      return;
    }
    if (
      liveTranscription.isListening ||
      liveTranscription.status === "requesting" ||
      autoStartAttemptedMeetingIdRef.current === meeting.id
    ) {
      return;
    }
    autoStartAttemptedMeetingIdRef.current = meeting.id;
    void (async () => {
      const ok = await liveTranscription.start();
      if (!ok) await switchToManualTranscription(meeting);
    })();
  }, [
    liveTranscription.isListening,
    liveTranscription.start,
    liveTranscription.status,
    manualFallbackMeetingId,
    meeting,
    switchToManualTranscription,
  ]);

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
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(420px,1.35fr)_minmax(340px,0.85fr)] gap-3 p-4">
        <Skeleton className="h-full rounded-md" />
        <Skeleton className="h-full rounded-md" />
      </div>
    );
  }

  const projectTitle = projectById.get(meeting.project_id)?.title ?? "未命名项目";
  const effectiveASRProvider =
    manualFallbackMeetingId === meeting.id ? "manual" : meeting.asr_provider;
  const transcriptionAside = meetingTranscriptionAsideCopy(
    effectiveASRProvider,
    liveTranscription.status,
  );
  const durationSeconds = getMeetingDurationSeconds(meeting);
  const openCards = cards.filter((card) => card.status === "open");

  const submitSegment = async () => {
    const text = draft.trim();
    if (!text) return;
    const saved = await createTranscriptSegment(text, "manual");
    if (saved) {
      setDraft("");
    }
  };

  const updateTranscriptSegmentById = async (
    segmentId: string,
    data: { speaker_label?: string; text: string },
  ) => {
    try {
      await updateSegment.mutateAsync({
        meetingId: meeting.id,
        segmentId,
        data,
      });
      toast.success("转写已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新转写失败");
    }
  };

  const deleteTranscriptSegmentById = async (segmentId: string) => {
    try {
      await deleteSegment.mutateAsync({ meetingId: meeting.id, segmentId });
      toast.success("转写已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除转写失败");
    }
  };

  const splitTranscriptSegmentById = async (
    segmentId: string,
    data: { text_before: string; text_after: string; speaker_label_after?: string },
  ) => {
    try {
      await splitSegment.mutateAsync({
        meetingId: meeting.id,
        segmentId,
        data,
      });
      toast.success("转写已拆分");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "拆分转写失败");
    }
  };

  const mergeTranscriptSegmentsById = async (segmentId: string, targetSegmentId: string) => {
    try {
      await mergeSegment.mutateAsync({
        meetingId: meeting.id,
        segmentId,
        data: { target_segment_id: targetSegmentId },
      });
      toast.success("转写已合并");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "合并转写失败");
    }
  };

  const fallbackToManualTranscription = async () => {
    await switchToManualTranscription(meeting);
  };

  const startSession = async () => {
    try {
      const startedMeeting = await startMeeting.mutateAsync(meeting.id);
      const startASRProvider =
        manualFallbackMeetingId === meeting.id ? "manual" : startedMeeting.asr_provider;
      if (startASRProvider === "renderer") {
        const ok = await liveTranscription.start();
        if (!ok) await fallbackToManualTranscription();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "会议启动失败");
    }
  };

  const stopSession = async () => {
    liveTranscription.stop();
    if (audioRecordingState === "recording") stopAudioRecording();
    try {
      await stopMeeting.mutateAsync(meeting.id);
      if (segments.length > 0) {
        await generateSummary.mutateAsync(meeting.id);
        toast.success("会议已结束，纪要已生成");
      } else {
        toast.message("会议已结束，暂无转写可生成纪要");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "会议结束失败");
    }
  };

  const archiveCurrentMeeting = async () => {
    try {
      await archiveMeeting.mutateAsync(meeting.id);
      toast.success("会议已归档");
      navigation.push(projectId ? paths.projectMeetings(projectId) : paths.meetings());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "归档失败");
    }
  };

  const deleteCurrentMeeting = async () => {
    try {
      await deleteMeeting.mutateAsync(meeting.id);
      toast.success("会议已删除");
      navigation.push(projectId ? paths.projectMeetings(projectId) : paths.meetings());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setImportText(text);
      toast.success("文件已读取，可保存为转写");
    } catch {
      toast.error("读取文件失败");
    }
  };

  const saveImportText = async () => {
    const chunks = splitTranscriptText(importText);
    if (chunks.length === 0) return;
    let savedCount = 0;

    for (const chunk of chunks) {
      const saved = await createTranscriptSegment(chunk, "manual", "文件转写");
      if (!saved) break;
      savedCount += 1;
    }

    if (savedCount === chunks.length) {
      setImportText("");
      setImportOpen(false);
      toast.success(`已保存 ${chunks.length} 段文件转写`);
      return;
    }

    setImportText(chunks.slice(savedCount).join("\n\n"));
    if (savedCount > 0) {
      toast.message(`已保存 ${savedCount} 段，剩余 ${chunks.length - savedCount} 段已保留`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-[76px] shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="min-w-[280px] flex-1 basis-[360px]">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-base font-semibold">{meeting.title}</h1>
            <StatusBadge status={meeting.status} />
            <Badge variant="secondary" className="shrink-0">
              {analysisCopy[meeting.analysis_status] ?? meeting.analysis_status}
            </Badge>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="max-w-[160px] shrink-0 truncate">{projectTitle}</span>
            <span className="min-w-0 truncate">目标：{meeting.goal || "未填写"}</span>
          </div>
        </div>
        <MetricPill icon={Clock3} label={formatDuration(durationSeconds)} />
        <MetricPill icon={MessageSquareText} label={`${segments.length} 段转写`} />
        <MetricPill icon={Bot} label={`${openCards.length} 条待处理`} />
        {meeting.status === "running" ? (
          <Button size="sm" variant="outline" onClick={stopSession} disabled={stopMeeting.isPending}>
            <Square className="size-4" />
            结束
          </Button>
        ) : (
          <Button size="sm" onClick={startSession} disabled={startMeeting.isPending}>
            <Play className="size-4" />
            开始
          </Button>
        )}
        <MeetingMoreMenu
          soundEnabled={meeting.sound_enabled}
          onSoundChange={(checked) =>
            updateMeeting.mutate({ id: meeting.id, data: { sound_enabled: checked } })
          }
          onSettings={() => setEditing(true)}
          onImport={() => setImportOpen(true)}
          onSummary={() => setSummaryOpen(true)}
          onArchive={archiveCurrentMeeting}
          onDelete={() => setDeleteOpen(true)}
          archiveDisabled={archiveMeeting.isPending}
          deleteDisabled={deleteMeeting.isPending}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(420px,1.35fr)_minmax(340px,0.85fr)] overflow-hidden">
        <section className="flex min-h-0 min-w-0 flex-col border-r">
          <PanelTitle
            icon={MessageSquareText}
            title="实时转写"
            count={segments.length}
            aside={transcriptionAside}
          />
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <TranscriptFeed
              segments={segments}
              highlightedSeq={highlightedTranscriptSeq}
              interimTranscript={
                effectiveASRProvider === "renderer" ? liveTranscription.interimTranscript : ""
              }
              onUpdateSegment={updateTranscriptSegmentById}
              onDeleteSegment={deleteTranscriptSegmentById}
              onSplitSegment={splitTranscriptSegmentById}
              onMergeSegment={mergeTranscriptSegmentsById}
            />
          </div>
          <div className="border-t p-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.markdown,.text"
              className="hidden"
              onChange={handleFileChange}
            />
            {effectiveASRProvider !== "manual" && liveTranscription.error && (
              <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700">
                {liveTranscription.error}
              </div>
            )}
            <AudioRecorderPanel
              meetingTitle={meeting.title}
              recorder={audioRecorder}
              disabled={meeting.status !== "running"}
              realtimeUnavailable={
                effectiveASRProvider !== "renderer" || !liveTranscription.isSupported
              }
              saveStatus={
                saveAudioAsset.isPending
                  ? "saving"
                  : savedRecordingAsset
                    ? "saved"
                    : saveAudioAsset.isError
                      ? "error"
                      : "idle"
              }
              savedAssetName={savedRecordingAsset?.filename ?? null}
              onSaveToMeeting={saveRecordingToMeeting}
              asrJobStatus={activeASRJob?.status}
              asrJobError={activeASRJob?.error_message ?? ""}
              asrJobSourceSeqStart={activeASRJob?.source_seq_start ?? null}
              asrJobSourceSeqEnd={activeASRJob?.source_seq_end ?? null}
              onRetryASRJob={activeASRJob?.status === "failed" ? retryActiveASRJob : undefined}
            />
            <MeetingAudioAssetHistory
              assets={audioAssets}
              jobs={asrJobs}
              onRetryASRJob={retryMeetingASRJobById}
              onDeleteAudioAsset={deleteAudioAssetById}
            />
            <div className="flex gap-2">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={2}
                placeholder="追加一段现场转写"
                className="min-h-[58px] resize-none text-sm"
              />
              <Button
                size="icon"
                className="h-[58px] w-11 shrink-0"
                onClick={submitSegment}
                disabled={!draft.trim() || addSegment.isPending}
                title="保存转写"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 min-w-0 flex-col">
          <section className="flex min-h-0 flex-1 flex-col">
            <PanelTitle icon={Bot} title="旁听 Agent" count={cards.length} aside="实时分析问题" />
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
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {cards.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title="等待会议内容"
                  description="出现风险、问题、反馈或约束冲突时，Agent 会在这里提醒。"
                />
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
        </aside>
      </div>

      <ImportTranscriptDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        text={importText}
        onTextChange={setImportText}
        onUploadClick={() => fileInputRef.current?.click()}
        onSave={saveImportText}
        disabled={addSegment.isPending}
      />

      <SummaryDialog
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        summary={summary}
        transcriptSegments={segments}
        segmentCount={segments.length}
        pending={generateSummary.isPending}
        onSelectEvidenceSeq={(seq) => {
          setSummaryOpen(false);
          setHighlightedTranscriptSeq(seq);
        }}
        onGenerate={async () => {
          try {
            await generateSummary.mutateAsync(meeting.id);
            toast.success("纪要已更新");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "纪要生成失败");
          }
        }}
      />

      <DeleteMeetingDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        meetingTitle={meeting.title}
        disabled={deleteMeeting.isPending}
        onDelete={() => void deleteCurrentMeeting()}
      />

      {editing && (
        <EditMeetingDialog
          meeting={meeting}
          projects={projects}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function CreateMeetingDialog({
  projectId,
  defaultProjectId,
  template,
  projects,
  projectsLoading,
  onClose,
  onCreated,
}: {
  projectId?: string;
  defaultProjectId?: string;
  template: MeetingTemplate;
  projects: ProjectV12[];
  projectsLoading: boolean;
  onClose: () => void;
  onCreated: (meeting: MeetingSession) => void;
}) {
  const wsId = useWorkspaceId();
  const createMeeting = useCreateMeetingSession(wsId);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? defaultProjectId ?? "");
  const [selectedTemplateId, setSelectedTemplateId] = useState(template.id);
  const selectedTemplate =
    MEETING_TEMPLATES.find((item) => item.id === selectedTemplateId) ?? template;
  const [title, setTitle] = useState(template.title);
  const [goal, setGoal] = useState(template.goal);
  const [userRole, setUserRole] = useState(template.role);
  const [focus, setFocus] = useState(template.focus.join("\n"));
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [analysisEnabled, setAnalysisEnabled] = useState(true);
  const [realtimeTranscriptionEnabled, setRealtimeTranscriptionEnabled] = useState(true);

  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
    } else if (!selectedProjectId) {
      const firstProject = projects[0];
      if (firstProject) setSelectedProjectId(firstProject.id);
    }
  }, [projectId, projects, selectedProjectId]);

  const applyTemplate = (nextId: string) => {
    const next = MEETING_TEMPLATES.find((item) => item.id === nextId);
    if (!next) return;
    setSelectedTemplateId(next.id);
    setTitle(next.title);
    setGoal(next.goal);
    setUserRole(next.role);
    setFocus(next.focus.join("\n"));
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.error("先填写会议标题");
      return;
    }
    const targetProjectId = projectId ?? selectedProjectId;
    if (!targetProjectId) {
      toast.error("先选择所属项目");
      return;
    }
    try {
      const meeting = await createMeeting.mutateAsync({
        project_id: targetProjectId,
        title: title.trim(),
        goal: goal.trim(),
        user_role: userRole.trim(),
        sound_enabled: soundEnabled,
        asr_provider: realtimeTranscriptionEnabled ? "renderer" : "manual",
        reminder_mode: "strong",
        reminder_intensity: "standard",
        model_source: analysisEnabled ? "local" : "not_configured",
        analysis_enabled: analysisEnabled,
        strategy: {
          template_id: selectedTemplate.id,
          focus: focus
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          expected_outcomes: ["实时转写", "Agent 旁听分析", "会后纪要"],
        },
      });
      onClose();
      onCreated(meeting);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建会议失败");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建会议</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {MEETING_TEMPLATES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => applyTemplate(item.id)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  item.id === selectedTemplateId ? "border-primary bg-primary/10" : "hover:bg-muted",
                )}
              >
                <span className="block truncate font-medium">{item.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {item.focus.slice(0, 2).join(" / ")}
                </span>
              </button>
            ))}
          </div>

          {!projectId && (
            <div className="space-y-1.5">
              <Label htmlFor="meeting-project">所属项目</Label>
              <Select
                value={selectedProjectId}
                onValueChange={(value) => setSelectedProjectId(value ?? "")}
                disabled={projectsLoading || projects.length === 0}
              >
                <SelectTrigger id="meeting-project">
                  <SelectValue placeholder={projectsLoading ? "加载项目中" : "选择项目"} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {projects.length === 0 && !projectsLoading && (
                <p className="text-xs text-muted-foreground">先创建项目工作区，再创建会议。</p>
              )}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="meeting-title">标题</Label>
              <Input
                id="meeting-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-role">参会角色</Label>
              <Input
                id="meeting-role"
                value={userRole}
                onChange={(event) => setUserRole(event.target.value)}
                placeholder="产品负责人 / 销售 / 技术负责人"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="meeting-goal">会议目标</Label>
            <Textarea
              id="meeting-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-focus">Agent 关注点</Label>
            <Textarea
              id="meeting-focus"
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              rows={4}
            />
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <ToggleRow label="实时语音转写" checked={realtimeTranscriptionEnabled} onChange={setRealtimeTranscriptionEnabled} />
            <ToggleRow label="Agent 旁听分析" checked={analysisEnabled} onChange={setAnalysisEnabled} />
            <ToggleRow label="强提醒提示音" checked={soundEnabled} onChange={setSoundEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={createMeeting.isPending || (!projectId && projects.length === 0)}
          >
            创建会议
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditMeetingDialog({
  meeting,
  projects,
  onClose,
  onSaved,
}: {
  meeting: MeetingSession;
  projects: ProjectV12[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const wsId = useWorkspaceId();
  const { data: asrStatus } = useQuery(meetingASRStatusOptions(wsId));
  const updateMeeting = useUpdateMeetingSession(wsId);
  const [title, setTitle] = useState(meeting.title);
  const [goal, setGoal] = useState(meeting.goal);
  const [userRole, setUserRole] = useState(meeting.user_role);
  const [focus, setFocus] = useState((meeting.strategy.focus ?? []).join("\n"));
  const [soundEnabled, setSoundEnabled] = useState(meeting.sound_enabled);
  const [analysisEnabled, setAnalysisEnabled] = useState(meeting.analysis_status !== "paused");
  const [asrProvider, setAsrProvider] = useState<MeetingASRProvider>(meeting.asr_provider);

  const projectTitle = projects.find((project) => project.id === meeting.project_id)?.title ?? "当前项目";

  const submit = async () => {
    if (!title.trim()) {
      toast.error("会议标题不能为空");
      return;
    }
    try {
      await updateMeeting.mutateAsync({
        id: meeting.id,
        data: {
          title: title.trim(),
          goal: goal.trim(),
          user_role: userRole.trim(),
          sound_enabled: soundEnabled,
          asr_provider: asrProvider,
          model_source: analysisEnabled ? "local" : "not_configured",
          analysis_enabled: analysisEnabled,
          strategy: {
            ...meeting.strategy,
            focus: focus
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
          },
        },
      });
      toast.success("会议设置已保存");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>会议设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{projectTitle}</div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-meeting-title">标题</Label>
            <Input id="edit-meeting-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-meeting-goal">目标</Label>
            <Textarea id="edit-meeting-goal" value={goal} onChange={(event) => setGoal(event.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-meeting-role">参会角色</Label>
            <Input id="edit-meeting-role" value={userRole} onChange={(event) => setUserRole(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-meeting-focus">Agent 关注点</Label>
            <Textarea id="edit-meeting-focus" value={focus} onChange={(event) => setFocus(event.target.value)} rows={3} />
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <ToggleRow label="提示音" checked={soundEnabled} onChange={setSoundEnabled} />
            <ToggleRow label="Agent 分析" checked={analysisEnabled} onChange={setAnalysisEnabled} />
            <div className="rounded-md border p-3">
              <Label className="mb-2 block text-sm">转写方式</Label>
              <Select value={asrProvider} onValueChange={(value) => setAsrProvider(value as MeetingASRProvider)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="renderer">实时语音</SelectItem>
                  <SelectItem value="manual">手动记录</SelectItem>
                  <SelectItem value="local">本地模型</SelectItem>
                  <SelectItem value="external">外部服务</SelectItem>
                </SelectContent>
              </Select>
              <MeetingASRStatusNotice selectedProvider={asrProvider} status={asrStatus} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={updateMeeting.isPending}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MeetingASRStatusNotice({
  selectedProvider,
  status,
}: {
  selectedProvider: MeetingASRProvider;
  status?: MeetingASRStatus;
}) {
  if (selectedProvider !== "local" && selectedProvider !== "external") return null;
  const provider = selectedProvider === "local" ? status?.local : status?.external;
  const copy =
    selectedProvider === "local"
      ? {
          checking: "本地模型检测中",
          available: "本地模型可用",
          unavailable: "本地模型不可用",
          unconfigured: "本地模型未配置",
          fallback: "设置 MEETING_ASR_LOCAL_COMMAND 后可用",
          name: "本地命令",
        }
      : {
          checking: "外部服务检测中",
          available: "外部服务可用",
          unavailable: "外部服务不可用",
          unconfigured: "外部服务未配置",
          fallback: "设置 MEETING_ASR_EXTERNAL_ENDPOINT 后可用",
          name: "外部服务",
        };
  const label = !provider
    ? copy.checking
    : provider.available
      ? copy.available
      : provider.configured
        ? copy.unavailable
        : copy.unconfigured;
  const detail = !provider
    ? `正在读取${selectedProvider === "local" ? "本地" : "外部"}转写配置`
    : provider.available
      ? `${provider.command_name ?? copy.name} · ${provider.timeout_seconds} 秒超时`
      : provider.error || copy.fallback;

  return (
    <div className="mt-2 rounded-md border bg-background px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <Badge variant={provider?.available ? "default" : "secondary"}>{label}</Badge>
        <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
}

function QuickLaunchStrip({
  templates,
  disabled,
  onSelect,
}: {
  templates: MeetingTemplate[];
  disabled: boolean;
  onSelect: (template: MeetingTemplate) => void;
}) {
  return (
    <div className="shrink-0 border-b px-4 py-3">
      <div className="grid gap-2 md:grid-cols-4">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(template)}
            className="rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{template.label}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {template.focus.join(" / ")}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function MeetingMoreMenu({
  soundEnabled,
  onSoundChange,
  onSettings,
  onImport,
  onSummary,
  onArchive,
  onDelete,
  archiveDisabled,
  deleteDisabled,
}: {
  soundEnabled: boolean;
  onSoundChange: (checked: boolean) => void;
  onSettings: () => void;
  onImport: () => void;
  onSummary: () => void;
  onArchive: () => void;
  onDelete: () => void;
  archiveDisabled: boolean;
  deleteDisabled: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
        <MoreHorizontal className="size-4" />
        更多
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onSettings}>
          <Pencil className="size-4" />
          会议设置
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImport}>
          <Upload className="size-4" />
          导入转写
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSummary}>
          <FileText className="size-4" />
          纪要生成 / 查看
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
          <span className="flex items-center gap-2">
            {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            提示音
          </span>
          <Switch checked={soundEnabled} onCheckedChange={onSoundChange} aria-label="提示音" />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onArchive} disabled={archiveDisabled}>
          <Archive className="size-4" />
          归档
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={onDelete}
          disabled={deleteDisabled}
        >
          <Trash2 className="size-4" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ImportTranscriptDialog({
  open,
  onOpenChange,
  text,
  onTextChange,
  onUploadClick,
  onSave,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  onTextChange: (value: string) => void;
  onUploadClick: () => void;
  onSave: () => void;
  disabled: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>导入转写</DialogTitle>
        </DialogHeader>
        <SourceImportPanel
          text={text}
          onTextChange={onTextChange}
          onUploadClick={onUploadClick}
          onSave={onSave}
          disabled={disabled}
        />
      </DialogContent>
    </Dialog>
  );
}

function SummaryDialog({
  open,
  onOpenChange,
  summary,
  transcriptSegments,
  segmentCount,
  pending,
  onSelectEvidenceSeq,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary?: MeetingSummary;
  transcriptSegments: MeetingTranscriptSegment[];
  segmentCount: number;
  pending: boolean;
  onSelectEvidenceSeq: (seq: number) => void;
  onGenerate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>会议纪要</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          <SummaryPanel
            summary={summary}
            transcriptSegments={transcriptSegments}
            segmentCount={segmentCount}
            pending={pending}
            onSelectEvidenceSeq={onSelectEvidenceSeq}
            onGenerate={onGenerate}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteMeetingDialog({
  open,
  onOpenChange,
  meetingTitle,
  disabled,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingTitle: string;
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除「{meetingTitle}」？</AlertDialogTitle>
          <AlertDialogDescription>
            此操作无法撤销。会议转写、洞察卡片和纪要会一并删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={disabled}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={disabled}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {disabled ? "删除中…" : "确认删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MeetingListItem({
  meeting,
  active,
  projectTitle,
  projectScoped,
  onClick,
}: {
  meeting: MeetingSession;
  active: boolean;
  projectTitle?: string;
  projectScoped: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-md px-3 py-3 text-left transition-colors",
        active ? "bg-background shadow-sm ring-1 ring-border" : "hover:bg-background/70",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{meeting.title}</span>
        <StatusBadge status={meeting.status} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          {projectScoped ? meeting.user_role || "未设角色" : projectTitle ?? "未命名项目"}
        </span>
        <span className="shrink-0">{formatDuration(getMeetingDurationSeconds(meeting))}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {meeting.sound_enabled ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
        <span>{analysisCopy[meeting.analysis_status] ?? meeting.analysis_status}</span>
      </div>
    </button>
  );
}

type TranscriptFeedProps = {
  segments: MeetingTranscriptSegment[];
  highlightedSeq?: number | null;
  interimTranscript: string;
  onUpdateSegment?: (
    segmentId: string,
    data: { speaker_label?: string; text: string },
  ) => void | Promise<void>;
  onDeleteSegment?: (segmentId: string) => void | Promise<void>;
  onSplitSegment?: (
    segmentId: string,
    data: { text_before: string; text_after: string; speaker_label_after?: string },
  ) => void | Promise<void>;
  onMergeSegment?: (segmentId: string, targetSegmentId: string) => void | Promise<void>;
};

export function buildTranscriptSplitDraft(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 2) return null;
  const newlineIndex = trimmed.indexOf("\n");
  if (newlineIndex > 0 && newlineIndex < trimmed.length - 1) {
    return {
      text_before: trimmed.slice(0, newlineIndex).trim(),
      text_after: trimmed.slice(newlineIndex + 1).trim(),
    };
  }
  const midpoint = Math.floor(trimmed.length / 2);
  if (midpoint <= 0 || midpoint >= trimmed.length) return null;
  return {
    text_before: trimmed.slice(0, midpoint).trim(),
    text_after: trimmed.slice(midpoint).trim(),
  };
}

export function TranscriptFeed({
  segments,
  highlightedSeq,
  interimTranscript,
  onUpdateSegment,
  onDeleteSegment,
  onSplitSegment,
  onMergeSegment,
}: TranscriptFeedProps) {
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [editSpeaker, setEditSpeaker] = useState("");
  const [editText, setEditText] = useState("");
  const trimmedInterim = interimTranscript.trim();
  if (segments.length === 0 && !trimmedInterim) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title="暂无转写"
        description="开始会议后实时语音会进入这里，也可以粘贴文件转写。"
      />
    );
  }
  const beginEdit = (segment: MeetingTranscriptSegment) => {
    setEditingSegmentId(segment.id);
    setEditSpeaker(segment.speaker_label);
    setEditText(segment.text);
  };
  const cancelEdit = () => {
    setEditingSegmentId(null);
    setEditSpeaker("");
    setEditText("");
  };
  const saveEdit = async (segmentId: string) => {
    if (!editText.trim() || !onUpdateSegment) return;
    await onUpdateSegment(segmentId, {
      speaker_label: editSpeaker.trim() || undefined,
      text: editText.trim(),
    });
    cancelEdit();
  };

  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        const nextSegment = segments[index + 1];
        const isEditing = editingSegmentId === segment.id;
        const splitDraft = buildTranscriptSplitDraft(segment.text);
        return (
          <div
            id={transcriptSegmentDomId(segment.seq)}
            key={segment.id}
            className={cn(
              "rounded-md border bg-background px-3 py-2",
              highlightedSeq === segment.seq && "border-primary bg-primary/5 ring-1 ring-primary/20",
            )}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">
                {segment.speaker_label || sourceCopy[segment.source] || "现场"}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <span>#{segment.seq}</span>
                {onUpdateSegment && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => beginEdit(segment)}
                    title="编辑转写"
                    aria-label={`编辑第 ${segment.seq} 段转写`}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                )}
                {onSplitSegment && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={!splitDraft}
                    onClick={() => splitDraft && onSplitSegment(segment.id, splitDraft)}
                    title="拆分转写"
                    aria-label={`拆分第 ${segment.seq} 段转写`}
                  >
                    <Scissors className="size-3.5" />
                  </Button>
                )}
                {onMergeSegment && nextSegment && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onMergeSegment(segment.id, nextSegment.id)}
                    title="合并下一段"
                    aria-label={`合并第 ${segment.seq} 段和第 ${nextSegment.seq} 段转写`}
                  >
                    <Merge className="size-3.5" />
                  </Button>
                )}
                {onDeleteSegment && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onDeleteSegment(segment.id)}
                    title="删除转写"
                    aria-label={`删除第 ${segment.seq} 段转写`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
            {isEditing ? (
              <div className="space-y-2">
                <Input
                  value={editSpeaker}
                  onChange={(event) => setEditSpeaker(event.target.value)}
                  aria-label="转写说话人"
                  className="h-8 text-sm"
                />
                <Textarea
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  aria-label="转写内容"
                  rows={3}
                  className="min-h-[88px] resize-none text-sm"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={cancelEdit}>
                    <X className="size-4" />
                    取消
                  </Button>
                  <Button size="sm" onClick={() => saveEdit(segment.id)} disabled={!editText.trim()}>
                    <Save className="size-4" />
                    保存
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-6">{segment.text}</p>
            )}
          </div>
        );
      })}
      {trimmedInterim && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-primary">
            <Mic className="size-3" />
            正在识别
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {trimmedInterim}
          </p>
        </div>
      )}
    </div>
  );
}

export function SourceImportPanel({
  text,
  onTextChange,
  onUploadClick,
  onSave,
  disabled,
}: {
  text: string;
  onTextChange: (value: string) => void;
  onUploadClick: () => void;
  onSave: () => void;
  disabled: boolean;
}) {
  return (
    <div className="mb-3 rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="size-4 text-muted-foreground" />
          文件转文字沉淀
        </div>
        <Button size="sm" variant="outline" onClick={onUploadClick}>
          <Upload className="size-4" />
          读取文本
        </Button>
      </div>
      <Textarea
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="粘贴会议文件转写内容，保存后按段落写入本场会议"
        rows={8}
        className="h-40 min-h-40 max-h-40 resize-none overflow-y-auto bg-background text-sm [field-sizing:fixed]"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="secondary" onClick={onSave} disabled={disabled || !text.trim()}>
          保存为转写
        </Button>
      </div>
    </div>
  );
}

export function MeetingAudioAssetHistory({
  assets,
  jobs,
  onRetryASRJob,
  onDeleteAudioAsset,
}: {
  assets: MeetingAudioAsset[];
  jobs: MeetingASRJob[];
  onRetryASRJob?: (jobId: string) => void;
  onDeleteAudioAsset?: (assetId: string) => void;
}) {
  if (assets.length === 0) return null;
  const history = groupMeetingAudioHistory(assets, jobs);

  return (
    <div className="mb-2 rounded-md border bg-background px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Volume2 className="size-4 text-muted-foreground" />
          已保存录音
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{assets.length} 个文件</span>
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
        {history.map(({ asset, latestJob, jobs: assetJobs }) => {
          return (
            <div
              key={asset.id}
              className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-1.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{asset.filename}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {formatMeetingAudioAssetHistory(asset, latestJob, assetJobs.length)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {latestJob && <MeetingASRJobBadge status={latestJob.status} />}
                {latestJob?.status === "failed" && onRetryASRJob && (
                  <Button size="sm" variant="outline" onClick={() => onRetryASRJob(latestJob.id)}>
                    <RefreshCw className="size-4" />
                    重试
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  render={<a href={asset.download_url || asset.url} download={asset.filename} />}
                >
                  <Download className="size-4" />
                  下载
                </Button>
                {onDeleteAudioAsset && (
                  <Button size="sm" variant="ghost" onClick={() => onDeleteAudioAsset(asset.id)}>
                    <Trash2 className="size-4" />
                    删除
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function groupMeetingAudioHistory(assets: MeetingAudioAsset[], jobs: MeetingASRJob[]) {
  const jobsByAssetId = new Map<string, MeetingASRJob[]>();
  for (const job of jobs) {
    const assetJobs = jobsByAssetId.get(job.audio_asset_id) ?? [];
    assetJobs.push(job);
    jobsByAssetId.set(job.audio_asset_id, assetJobs);
  }

  return assets.map((asset) => {
    const assetJobs = [...(jobsByAssetId.get(asset.id) ?? [])].sort((a, b) =>
      (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
    );
    return {
      asset,
      jobs: assetJobs,
      latestJob: assetJobs[0],
    };
  });
}

export function AudioRecorderPanel({
  meetingTitle,
  recorder,
  disabled,
  realtimeUnavailable,
  saveStatus = "idle",
  savedAssetName,
  onSaveToMeeting,
  asrJobStatus,
  asrJobError,
  asrJobSourceSeqStart,
  asrJobSourceSeqEnd,
  onRetryASRJob,
}: {
  meetingTitle: string;
  recorder: MeetingAudioRecorderController;
  disabled: boolean;
  realtimeUnavailable: boolean;
  saveStatus?: "idle" | "saving" | "saved" | "error";
  savedAssetName?: string | null;
  onSaveToMeeting?: () => void;
  asrJobStatus?: MeetingASRJobStatus;
  asrJobError?: string;
  asrJobSourceSeqStart?: number | null;
  asrJobSourceSeqEnd?: number | null;
  onRetryASRJob?: () => void;
}) {
  const recording = recorder.recording;
  const isRecording = recorder.state === "recording";
  const canDownload = Boolean(recording);
  const temporaryRecordingWarning = "停止后先保存到会议，下载副本只是本地兜底";
  const recordingErrorNextStep = "检查系统麦克风权限或外接麦克风，也可继续手动记录";
  const canSaveToMeeting = Boolean(recording && onSaveToMeeting);
  const statusText =
    recorder.state === "recording"
      ? `临时录音中 ${formatRecordingDuration(recorder.elapsedSeconds)}，${temporaryRecordingWarning}`
      : recorder.state === "ready" && recording
        ? `已临时录制 ${formatRecordingDuration(recording.durationSeconds)}，${temporaryRecordingWarning}`
        : recorder.state === "error" && recorder.error
          ? recorder.error
          : disabled
            ? "开始会议后可录音"
            : realtimeUnavailable
              ? `实时转写不可用，可先临时录音；${temporaryRecordingWarning}`
              : `临时录音；${temporaryRecordingWarning}`;
  const downloadName = recording
    ? buildMeetingAudioFileName(meetingTitle, recording.startedAt, recording.mimeType)
    : "";

  const startRecording = async () => {
    await recorder.start();
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
      <div className="flex min-w-[180px] flex-1 items-center gap-2 text-sm">
        <Mic className={cn("size-4", isRecording ? "text-red-600" : "text-muted-foreground")} />
        <span className="font-medium">临时录音</span>
        <div className="min-w-0 text-xs">
          <div
            className={cn(
              "truncate",
              recorder.state === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {statusText}
          </div>
          {recorder.state === "error" && (
            <div className="truncate text-muted-foreground">{recordingErrorNextStep}</div>
          )}
          <div className="text-muted-foreground">
            当前只录麦克风，不捕获系统声音或会议软件扬声器音频；需要完整会议音频时，请用会议软件录制后导入。
          </div>
          {saveStatus === "saved" && (
            <div className="truncate text-muted-foreground">
              已保存到会议{savedAssetName ? `：${savedAssetName}` : ""}
            </div>
          )}
          {saveStatus === "error" && (
            <div className="truncate text-destructive">保存到会议失败，可重试或下载副本</div>
          )}
          {asrJobStatus === "running" && (
            <div className="truncate text-muted-foreground">自动转写任务处理中</div>
          )}
          {asrJobStatus === "failed" && (
            <div className="truncate text-destructive">
              自动转写失败{asrJobError ? `：${asrJobError}` : ""}
            </div>
          )}
          {asrJobStatus === "completed" && (
            <div className="truncate text-muted-foreground">
              自动转写已完成
              {asrJobSourceSeqStart && asrJobSourceSeqEnd
                ? `，已追加 ${asrJobSourceSeqStart}-${asrJobSourceSeqEnd} 段转写`
                : ""}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isRecording ? (
          <Button size="sm" variant="outline" onClick={recorder.stop}>
            <Square className="size-4" />
            停止
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={startRecording} disabled={disabled}>
            <Mic className="size-4" />
            开始录音
          </Button>
        )}
        {canSaveToMeeting && (
          <Button
            size="sm"
            variant="secondary"
            onClick={onSaveToMeeting}
            disabled={saveStatus === "saving" || saveStatus === "saved"}
          >
            <Upload className={cn("size-4", saveStatus === "saving" && "animate-pulse")} />
            {saveStatus === "saving"
              ? "保存中"
              : saveStatus === "saved"
                ? "已保存到会议"
                : "保存到会议"}
          </Button>
        )}
        {canDownload && recording && (
          <Button
            size="sm"
            variant={canSaveToMeeting ? "outline" : "secondary"}
            render={<a href={recording.url} download={downloadName} />}
          >
            <Download className="size-4" />
            {canSaveToMeeting ? "下载副本" : "保存录音"}
          </Button>
        )}
        {canDownload && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={recorder.reset}
            disabled={saveStatus === "saving"}
            title="清除录音"
          >
            <RotateCcw className="size-4" />
          </Button>
        )}
        {asrJobStatus === "failed" && onRetryASRJob && (
          <Button size="sm" variant="outline" onClick={onRetryASRJob}>
            <RefreshCw className="size-4" />
            重试转写
          </Button>
        )}
      </div>
    </div>
  );
}

function MeetingASRJobBadge({ status }: { status: MeetingASRJobStatus }) {
  const tone: Partial<Record<MeetingASRJobStatus, string>> = {
    completed: "bg-emerald-500/15 text-emerald-700",
    failed: "bg-red-500/15 text-red-600",
    running: "bg-blue-500/15 text-blue-700",
    queued: "bg-muted text-muted-foreground",
    cancelled: "bg-muted text-muted-foreground",
  };
  const label: Record<MeetingASRJobStatus, string> = {
    queued: "排队中",
    running: "转写中",
    completed: "已转写",
    failed: "失败",
    cancelled: "已取消",
  };

  return (
    <Badge variant="secondary" className={cn("shrink-0", tone[status])}>
      {label[status]}
    </Badge>
  );
}

function formatMeetingAudioAssetHistory(
  asset: MeetingAudioAsset,
  job?: MeetingASRJob,
  jobCount = job ? 1 : 0,
): string {
  const durationText =
    asset.duration_seconds && asset.duration_seconds > 0
      ? `录音 ${formatRecordingDuration(asset.duration_seconds)}`
      : "录音已保存";
  const attemptsText = jobCount > 1 ? `，共 ${jobCount} 次转写任务` : "";
  if (!job) return `${durationText}，未创建自动转写任务`;
  if (job.status === "completed") {
    const range =
      job.source_seq_start && job.source_seq_end
        ? `，已追加 ${job.source_seq_start}-${job.source_seq_end} 段`
        : "";
    return `自动转写已完成${range}${attemptsText}`;
  }
  if (job.status === "failed") {
    return `自动转写失败${job.error_message ? `：${job.error_message}` : ""}${attemptsText}`;
  }
  if (job.status === "running") return `自动转写处理中${attemptsText}`;
  if (job.status === "queued") return `自动转写排队中${attemptsText}`;
  return `自动转写已取消${attemptsText}`;
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
      {card.suggested_question && (
        <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-sm leading-6">
          {card.suggested_question}
        </p>
      )}
      {card.evidence_quote && (
        <blockquote className="mt-2 border-l-2 pl-2 text-xs leading-5 text-muted-foreground">
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
        "m-4 mb-0 rounded-md border p-3 shadow-sm ring-2 ring-offset-2 ring-offset-background",
        card.severity === "L3"
          ? "border-red-500 bg-red-500/10 ring-red-500/25"
          : "border-amber-500 bg-amber-500/10 ring-amber-500/25",
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
            {card.severity === "L3" ? "高优先级提醒" : "强提醒"}
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
          {soundEnabled ? "提示音开启" : "静音"}
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

export function SummaryPanel({
  summary,
  transcriptSegments = [],
  segmentCount,
  pending,
  onSelectEvidenceSeq,
  onGenerate,
}: {
  summary?: MeetingSummary;
  transcriptSegments?: MeetingTranscriptSegment[];
  segmentCount: number;
  pending: boolean;
  onSelectEvidenceSeq?: (seq: number) => void;
  onGenerate: () => void;
}) {
  const evidenceLinks = summary ? buildSummaryEvidenceLinks(summary, transcriptSegments) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="mb-3 grid grid-cols-3 gap-2">
        <SummaryMetric label="时长" value={summary ? formatDuration(summary.duration_seconds) : "--"} />
        <SummaryMetric label="决策" value={String(summary?.decisions.length ?? 0)} />
        <SummaryMetric label="行动项" value={String(summary?.action_items.length ?? 0)} />
      </div>
      {summary && (
        <div className="mb-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-background">
              规则草稿
            </Badge>
            <span className="font-medium text-foreground">需人工复核</span>
          </div>
          <p className="mt-1 leading-5">
            当前纪要由规则/关键词自动整理，仅作为复盘草稿，确认后再作为正式会议纪要使用。
          </p>
        </div>
      )}
      {evidenceLinks.length > 0 && (
        <div className="mb-3 rounded-md border bg-background px-3 py-2">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <MessageSquareText className="size-4 text-muted-foreground" />
            转写依据
          </div>
          <div className="flex flex-wrap gap-2">
            {evidenceLinks.map((link) => (
              <Button
                key={`${link.section}-${link.seq}-${link.item}`}
                size="sm"
                variant="outline"
                onClick={() => onSelectEvidenceSeq?.(link.seq)}
              >
                <span className="max-w-40 truncate text-xs text-muted-foreground">
                  {link.section}
                </span>
                第 {link.seq} 段
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background p-3">
        {summary ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{summary.summary_md}</pre>
        ) : (
          <EmptyState
            icon={FileText}
            title="暂无纪要"
            description="会议结束时会自动生成，也可以随时手动刷新。"
          />
        )}
      </div>
      <Button
        className="mt-3"
        variant="outline"
        onClick={onGenerate}
        disabled={pending || segmentCount === 0}
      >
        <RefreshCw className={cn("size-4", pending && "animate-spin")} />
        {summary ? "重新生成纪要" : "生成纪要"}
      </Button>
    </div>
  );
}

function buildSummaryEvidenceLinks(
  summary: MeetingSummary,
  transcriptSegments: MeetingTranscriptSegment[],
): Array<{ section: string; item: string; seq: number }> {
  if (transcriptSegments.length === 0) return [];
  const sections = [
    ["核心结论", summary.decisions],
    ["风险与阻塞", summary.risks],
    ["待澄清问题", summary.questions],
    ["行动项", summary.action_items],
    ["用户反馈", summary.feedback],
    ["约束冲突", summary.tensions],
    ["项目记忆候选", summary.memory_candidates],
  ] as const;
  const links: Array<{ section: string; item: string; seq: number }> = [];
  const seenSeq = new Set<number>();

  for (const [section, items] of sections) {
    for (const item of items) {
      const segment = findSummaryEvidenceSegment(item, transcriptSegments);
      if (!segment || seenSeq.has(segment.seq)) continue;
      links.push({ section, item, seq: segment.seq });
      seenSeq.add(segment.seq);
    }
  }

  return links.slice(0, 8);
}

function findSummaryEvidenceSegment(
  item: string,
  transcriptSegments: MeetingTranscriptSegment[],
): MeetingTranscriptSegment | undefined {
  const normalizedItem = normalizeSummaryEvidenceText(item);
  if (!normalizedItem) return undefined;
  return transcriptSegments.find((segment) => {
    const segmentText = normalizeSummaryEvidenceText(meetingTranscriptSegmentText(segment));
    const rawText = normalizeSummaryEvidenceText(segment.text);
    return normalizedItem === segmentText || normalizedItem.includes(rawText);
  });
}

function meetingTranscriptSegmentText(segment: MeetingTranscriptSegment): string {
  const text = segment.text.trim();
  const speaker = segment.speaker_label.trim();
  return speaker ? `${speaker}：${text}` : text;
}

function normalizeSummaryEvidenceText(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function PanelTitle({
  icon: Icon,
  title,
  count,
  aside,
}: {
  icon: typeof Mic;
  title: string;
  count: number;
  aside?: string;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
      <Icon className="size-4 text-muted-foreground" />
      <span className="text-sm font-medium">{title}</span>
      {aside && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{aside}</span>}
      <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
        {count}
      </Badge>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Mic;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-md border border-dashed px-6 py-8 text-center">
      <Icon className="mb-3 size-8 text-muted-foreground opacity-60" />
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 max-w-[320px] text-xs leading-5 text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function MetricPill({ icon: Icon, label }: { icon: typeof Mic; label: string }) {
  return (
    <div className="hidden shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground xl:flex">
      <Icon className="size-3.5" />
      <span className="whitespace-nowrap">{label}</span>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
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
        severity === "L3" && "bg-red-500/15 text-red-600",
        severity === "L2" && "bg-amber-500/15 text-amber-700",
        severity === "L1" && "bg-muted text-muted-foreground",
      )}
    >
      {severity}
    </Badge>
  );
}

function getMeetingDurationSeconds(meeting: MeetingSession): number {
  if (!meeting.started_at) return 0;
  const start = new Date(meeting.started_at).getTime();
  const end = meeting.stopped_at ? new Date(meeting.stopped_at).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return Number.isFinite(seconds) ? seconds : 0;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0 分钟";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${Math.max(1, minutes)} 分钟`;
}

function formatRecordingDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const mmss = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
  return hours > 0 ? `${hours.toString().padStart(2, "0")}:${mmss}` : mmss;
}

function transcriptSegmentDomId(seq: number): string {
  return `meeting-transcript-${seq}`;
}

export function splitTranscriptText(text: string): string[] {
  return text
    .split(/\n{2,}|\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function playMeetingAlertSound() {
  if (typeof window === "undefined") return;
  const audioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!audioContextClass) return;
  const context = new audioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.value = 0.05;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.16);
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
  running: "bg-emerald-500/15 text-emerald-700",
  stopped: "bg-amber-500/15 text-amber-700",
  summarizing: "bg-blue-500/15 text-blue-700",
  completed: "bg-blue-500/15 text-blue-700",
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
  idle: "待启动",
  requesting: "请求麦克风",
  listening: "实时转写中",
  unsupported: "手动记录",
  error: "转写异常",
};

const typeCopy: Record<MeetingInsightCard["type"], string> = {
  question: "问题",
  risk: "风险",
  feedback: "反馈",
  tension: "冲突",
  summary: "总结",
};

const sourceCopy: Record<MeetingASRProvider, string> = {
  renderer: "实时转写",
  manual: "现场记录",
  local: "本地转写",
  external: "外部转写",
};
