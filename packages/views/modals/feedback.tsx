"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import {
  ContentEditor,
  type ContentEditorRef,
  useFileDropZone,
  FileDropOverlay,
} from "../editor";
import { useCreateFeedback, useFeedbackDraftStore } from "@multica/core/feedback";
import { useCurrentWorkspace } from "@multica/core/paths";
import { useFileUpload } from "@multica/core/hooks/use-file-upload";
import { api } from "@multica/core/api";
import { captureFeedbackOpened } from "@multica/core/analytics";

const MAX_MESSAGE_LEN = 10000;

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const workspace = useCurrentWorkspace();
  const draft = useFeedbackDraftStore((s) => s.draft);
  const setDraft = useFeedbackDraftStore((s) => s.setDraft);
  const clearDraft = useFeedbackDraftStore((s) => s.clearDraft);

  const editorRef = useRef<ContentEditorRef>(null);
  const [message, setMessage] = useState(draft.message);
  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) => files.forEach((f) => editorRef.current?.uploadFile(f)),
  });
  const { uploadWithToast } = useFileUpload(api);
  const mutation = useCreateFeedback();

  // Fire the "modal opened" analytics event once per mount. Pairs with
  // the backend's `feedback_submitted` to give a funnel completion rate.
  // Workspace id is captured from the closure at mount time — the modal
  // is short-lived, so there's no meaningful workspace switch to track.
  useEffect(() => {
    captureFeedbackOpened("help_menu", workspace?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit =
    message.trim().length > 0 &&
    message.length <= MAX_MESSAGE_LEN &&
    !mutation.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (editorRef.current?.hasActiveUploads()) {
      toast.info("请等待上传完成…");
      return;
    }
    // Read from the editor ref at submit time — `message` state lags 150ms
    // behind keystrokes due to `debounceMs`, so ⌘+Enter fired immediately
    // after typing would otherwise submit stale content.
    const latest = editorRef.current?.getMarkdown()?.trim() ?? "";
    if (!latest) return;
    if (latest.length > MAX_MESSAGE_LEN) {
      toast.error("内容太长");
      return;
    }
    try {
      await mutation.mutateAsync({
        message: latest,
        url: typeof window !== "undefined" ? window.location.href : undefined,
        workspace_id: workspace?.id,
      });
      clearDraft();
      toast.success("感谢反馈！");
      onClose();
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "发送反馈失败";
      toast.error(msg);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl !h-[28rem] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-2 shrink-0">
          <DialogTitle>反馈</DialogTitle>
          <DialogDescription>
            欢迎告诉我们哪些地方好用、哪里不好用，或你希望下一步看到什么。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 px-5 pb-3">
          <div
            {...dropZoneProps}
            className="relative h-full overflow-y-auto rounded-lg border-1 border-border transition-colors focus-within:border-brand"
          >
            <ContentEditor
              ref={editorRef}
              defaultValue={draft.message}
              placeholder="告诉我们你的使用体验、发现的问题，或希望看到的功能…"
              onUpdate={(md) => { setMessage(md); setDraft({ message: md }); }}
              onUploadFile={uploadWithToast}
              onSubmit={handleSubmit}
              debounceMs={150}
              showBubbleMenu={false}
              className="px-3 py-2"
            />
            {isDragOver && <FileDropOverlay />}
          </div>
        </div>

        <div className="flex items-center justify-end px-4 py-3 border-t shrink-0">
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {mutation.isPending ? "发送中…" : "发送反馈"}
            <kbd className="ml-1 inline-flex h-4 items-center gap-0.5 rounded border border-border/50 bg-background/30 px-1 font-mono text-[10px] leading-none">
              ⌘↵
            </kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
