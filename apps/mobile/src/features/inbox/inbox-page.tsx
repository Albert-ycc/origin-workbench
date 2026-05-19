import { CheckCheck } from "lucide-react";
import { demoInboxItems } from "../../fixtures/mobile-demo-data";
import type { InboxItem } from "../../types";
import {
  ActionButton,
  InboxStatusPill,
  InboxTypePill,
  MobilePage,
  MobileSection,
  PriorityPill,
} from "../../components";

interface InboxPageProps {
  items?: InboxItem[];
  onOpenItem?: (itemId: string) => void;
  onResolveItem?: (itemId: string) => void;
}

export function InboxPage({ items = demoInboxItems, onOpenItem, onResolveItem }: InboxPageProps) {
  const pendingCount = items.filter((item) => item.status !== "resolved").length;

  return (
    <MobilePage title="信箱" subtitle="集中处理风险、确认请求和执行结果。">
      <MobileSection title="待处理" meta={`${pendingCount} 条需要关注`}>
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-border bg-background p-3"
            >
              <button
                type="button"
                onClick={() => onOpenItem?.(item.id)}
                className="w-full text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    <InboxTypePill type={item.type} />
                    <InboxStatusPill status={item.status} />
                    {item.priority ? <PriorityPill priority={item.priority} /> : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{item.timeLabel}</span>
                </div>
                <p className="mt-2 line-clamp-1 text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">来源：{item.source}</p>
              </button>
              {item.status !== "resolved" ? (
                <div className="mt-3 flex justify-end">
                  <ActionButton onClick={() => onResolveItem?.(item.id)}>
                    <CheckCheck className="size-4" />
                    标记处理
                  </ActionButton>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </MobileSection>
    </MobilePage>
  );
}
