import { useState } from "react";
import {
  Lightbulb,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { demoIdeas } from "../../fixtures/mobile-demo-data";
import type { IdeaItem } from "../../types";
import { ActionButton, MobilePage, MobileSection, StatusPill } from "../../components";
import { useVoiceRecorder } from "../../lib/use-voice-recorder";
import { Rocket } from "lucide-react";

const readinessLabel: Record<IdeaItem["readiness"], string> = {
  raw: "粗想法",
  scoped: "已收口",
  ready: "可升级",
};

export interface VoiceCapturePayload {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}

interface IdeasPageProps {
  ideas?: IdeaItem[];
  onCaptureIdea?: (title: string) => void;
  onPromoteIdea?: (ideaId: string) => void;
  onSaveVoice?: (payload: VoiceCapturePayload) => Promise<void>;
  voiceEnabled?: boolean;
}

export function IdeasPage({
  ideas = demoIdeas,
  onCaptureIdea,
  onPromoteIdea,
  onSaveVoice,
  voiceEnabled = true,
}: IdeasPageProps) {
  const [title, setTitle] = useState("");

  function captureIdea() {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    onCaptureIdea?.(nextTitle);
    setTitle("");
  }

  return (
    <MobilePage title="想法池" subtitle="文字或语音快速归口，挑选成熟项升级成 Mission。">
      <MobileSection title="快速捕捉" meta="一句话或一段语音，先收下来">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="记录一个新想法"
              className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <ActionButton intent="primary" onClick={captureIdea}>保存</ActionButton>
          </div>
          {voiceEnabled ? (
            <VoiceCapture onSaveVoice={onSaveVoice} />
          ) : (
            <p className="text-xs text-muted-foreground">
              连接 Origin 后端后可在此用麦克风录一段语音想法。
            </p>
          )}
        </div>
      </MobileSection>

      <MobileSection title="候选想法" meta={`${ideas.length} 条`}>
        <div className="flex flex-col gap-2">
          {ideas.map((idea) => (
            <article key={idea.id} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  <Lightbulb className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-sm font-semibold">{idea.title}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{idea.note}</p>
                    </div>
                    <StatusPill tone={idea.readiness === "ready" ? "primary" : "muted"}>
                      {readinessLabel[idea.readiness]}
                    </StatusPill>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {idea.tags.map((tag) => (
                      <StatusPill key={tag} tone="muted">{tag}</StatusPill>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{idea.capturedAtLabel}</span>
                    <ActionButton
                      intent={idea.readiness === "ready" ? "primary" : "neutral"}
                      onClick={() => onPromoteIdea?.(idea.id)}
                    >
                      <Rocket className="size-4" />
                      升级
                    </ActionButton>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </MobileSection>
    </MobilePage>
  );
}

function formatSeconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

interface VoiceCaptureProps {
  onSaveVoice?: (payload: VoiceCapturePayload) => Promise<void>;
}

function VoiceCapture({ onSaveVoice }: VoiceCaptureProps) {
  const recorder = useVoiceRecorder();

  async function handleSave() {
    if (!onSaveVoice || !recorder.blob) return;
    recorder.setUploading();
    try {
      await onSaveVoice({
        blob: recorder.blob,
        durationSeconds: recorder.elapsed,
        mimeType: recorder.mimeType || recorder.blob.type || "audio/webm",
      });
      recorder.reset();
    } catch (caught) {
      recorder.setError(caught instanceof Error ? caught.message : "上传失败");
    }
  }

  if (recorder.state === "recording") {
    const remaining = Math.max(0, recorder.maxSeconds - recorder.elapsed);
    return (
      <VoiceShell tone="recording">
        <div className="flex items-center gap-3">
          <span className="recording-pulse" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold tabular-nums">{formatSeconds(recorder.elapsed)}</p>
            <p className="text-xs text-muted-foreground">还能录 {remaining}s · 最长 {recorder.maxSeconds}s</p>
          </div>
        </div>
        <button
          type="button"
          onClick={recorder.stop}
          className="voice-action voice-action-stop"
          aria-label="停止录音"
        >
          <Square className="size-4" />
          停止
        </button>
      </VoiceShell>
    );
  }

  if (recorder.state === "preview" && recorder.previewUrl) {
    return (
      <VoiceShell tone="preview">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              已录 <span className="font-semibold text-foreground">{formatSeconds(recorder.elapsed)}</span> · 试听后保存
            </p>
            <button
              type="button"
              onClick={recorder.reset}
              className="text-xs text-muted-foreground"
            >
              <RotateCcw className="mr-1 inline size-3" />
              重录
            </button>
          </div>
          <audio
            controls
            src={recorder.previewUrl}
            className="voice-audio"
            preload="metadata"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!onSaveVoice}
            className="voice-action voice-action-save"
          >
            <Upload className="size-4" />
            {onSaveVoice ? "上传到 Origin 附件" : "连接后端后再保存"}
          </button>
        </div>
      </VoiceShell>
    );
  }

  if (recorder.state === "uploading") {
    return (
      <VoiceShell tone="uploading">
        <div className="flex items-center gap-3">
          <Loader2 className="size-4 animate-spin text-primary" />
          <p className="text-sm">正在上传 {formatSeconds(recorder.elapsed)} 语音想法…</p>
        </div>
      </VoiceShell>
    );
  }

  return (
    <VoiceShell tone={recorder.state === "error" ? "error" : "idle"}>
      <VoiceIdleRow
        label={recorder.state === "error" ? recorder.error ?? "录音出错，点麦克风重试" : "点麦克风录一段语音"}
        icon={Mic}
        onClick={() => void recorder.start()}
        tone={recorder.state === "error" ? "error" : "idle"}
      />
    </VoiceShell>
  );
}

function VoiceShell({
  tone,
  children,
}: {
  tone: "idle" | "recording" | "preview" | "uploading" | "error";
  children: React.ReactNode;
}) {
  return <div className={`voice-shell voice-shell-${tone}`}>{children}</div>;
}

function VoiceIdleRow({
  label,
  icon: Icon,
  onClick,
  tone,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  tone: "idle" | "error";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className={`text-xs ${tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
        {label}
      </p>
      <button
        type="button"
        onClick={onClick}
        className="voice-mic-button"
        aria-label="开始录音"
      >
        <Icon className="size-5" />
      </button>
    </div>
  );
}
