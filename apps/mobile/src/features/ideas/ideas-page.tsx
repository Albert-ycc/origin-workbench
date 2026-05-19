import { useState } from "react";
import { Lightbulb, Rocket } from "lucide-react";
import { demoIdeas } from "../../fixtures/mobile-demo-data";
import type { IdeaItem } from "../../types";
import { ActionButton, MobilePage, MobileSection, StatusPill } from "../../components";

interface IdeasPageProps {
  ideas?: IdeaItem[];
  onCaptureIdea?: (title: string) => void;
  onPromoteIdea?: (ideaId: string) => void;
}

const readinessLabel: Record<IdeaItem["readiness"], string> = {
  raw: "粗想法",
  scoped: "已收口",
  ready: "可升级",
};

export function IdeasPage({ ideas = demoIdeas, onCaptureIdea, onPromoteIdea }: IdeasPageProps) {
  const [title, setTitle] = useState("");

  function captureIdea() {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    onCaptureIdea?.(nextTitle);
    setTitle("");
  }

  return (
    <MobilePage title="想法池" subtitle="快速捕捉想法，挑选成熟项升级成 Mission。">
      <MobileSection title="快速捕捉" meta="先收集，不打断当前执行">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="记录一个新想法"
            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          <ActionButton intent="primary" onClick={captureIdea}>保存</ActionButton>
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
                    <ActionButton intent={idea.readiness === "ready" ? "primary" : "neutral"} onClick={() => onPromoteIdea?.(idea.id)}>
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
