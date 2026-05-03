"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { childIssuesOptions } from "@multica/core/issues/queries";
import { useUpdateIssue } from "@multica/core/issues/mutations";
import { IssuePickerModal } from "./issue-picker-modal";

export function SetParentIssueModal({
  onClose,
  data,
}: {
  onClose: () => void;
  data: Record<string, unknown> | null;
}) {
  const issueId = (data?.issueId as string) || "";
  const wsId = useWorkspaceId();
  const updateIssue = useUpdateIssue();

  const { data: children = [] } = useQuery({
    ...childIssuesOptions(wsId, issueId),
    enabled: !!issueId,
  });

  const excludeIds = [issueId, ...children.map((c) => c.id)];

  return (
    <IssuePickerModal
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="设置父任务"
      description="搜索要设置为当前任务父级的任务"
      excludeIds={excludeIds}
      onSelect={(selected) => {
        updateIssue.mutate(
          { id: issueId, parent_issue_id: selected.id },
          { onError: () => toast.error("更新任务失败") },
        );
        toast.success(`已将 ${selected.identifier} 设置为父任务`);
      }}
    />
  );
}
