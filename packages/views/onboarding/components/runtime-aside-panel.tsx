/**
 * Shared right-rail aside for Step 3 (runtime).
 *
 * Same content on both paths — desktop (runtime-connect FancyView)
 * and web (platform-fork). Explains what a runtime is and reassures
 * the user they can swap later. Designed to live inside a two-column
 * editorial shell's `<aside>` column.
 */
export function RuntimeAsidePanel() {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-3 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          什么是运行环境？
        </div>
        <p className="text-[14px] leading-[1.6] text-foreground/80">
          <strong className="font-medium text-foreground">运行环境</strong>
          是运行在你机器上的小型后台进程。它把工作区连接到 Claude Code、Codex 等 AI 编程工具，并执行智能体接到的任务。
        </p>
      </section>

      <section>
        <div className="mb-3 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          你需要知道
        </div>
        <div className="flex flex-col gap-4">
          <AsideItem
            glyph="↻"
            title="随时切换"
            body="每个智能体的运行环境只是一个设置，需要时可以随时更换。"
          />
          <AsideItem
            glyph="∞"
            title="以后再添加"
            body="你可以为团队连接另一台机器上的运行环境，也可以给每个智能体单独配置。"
          />
        </div>
      </section>

      <a
        href="https://multica.ai/docs/daemon-runtimes"
        target="_blank"
        rel="noopener noreferrer"
        className="self-start text-[13px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
      >
        了解运行环境 →
      </a>
    </div>
  );
}

function AsideItem({
  glyph,
  title,
  body,
}: {
  glyph: string;
  title: string;
  body: string;
}) {
  return (
    <div className="grid grid-cols-[22px_1fr] gap-3">
      <div
        aria-hidden
        className="flex h-[20px] w-[20px] items-center justify-center text-[14px] text-muted-foreground"
      >
        {glyph}
      </div>
      <div className="flex flex-col">
        <div className="text-[13.5px] font-medium text-foreground">{title}</div>
        <div className="mt-1 text-[12.5px] leading-[1.55] text-muted-foreground">
          {body}
        </div>
      </div>
    </div>
  );
}
