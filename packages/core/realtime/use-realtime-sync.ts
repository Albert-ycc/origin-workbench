"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WSClient } from "../api/ws-client";
import type { StoreApi, UseBoundStore } from "zustand";
import type { AuthState } from "../auth/store";
import { createLogger } from "../logger";
import { clearWorkspaceStorage } from "../platform/storage-cleanup";
import { defaultStorage } from "../platform/storage";
import { getCurrentWsId, getCurrentSlug } from "../platform/workspace-storage";
import { issueKeys } from "../issues/queries";
import { projectKeys } from "../projects/queries";
import { projectV12Keys } from "../projects-v12/queries";
import { pinKeys } from "../pins/queries";
import { autopilotKeys } from "../autopilots/queries";
import { missionKeys } from "../missions/queries";
import { teamKeys } from "../teams/queries";
import { runtimeKeys } from "../runtimes/queries";
import { meetingKeys } from "../meetings/queries";
import {
  agentTaskSnapshotKeys,
  agentActivityKeys,
  agentRunCountsKeys,
  agentTasksKeys,
  agentMemoryKeys,
  agentSkillCandidateKeys,
  agentEventKeys,
} from "../agents/queries";
import {
  onIssueCreated,
  onIssueUpdated,
  onIssueDeleted,
  onIssueLabelsChanged,
} from "../issues/ws-updaters";
import { onInboxNew, onInboxInvalidate, onInboxIssueStatusChanged, onInboxIssueDeleted } from "../inbox/ws-updaters";
import { inboxKeys } from "../inbox/queries";
import { workspaceKeys, workspaceListOptions } from "../workspace/queries";
import { chatKeys } from "../chat/queries";
import { resolvePostAuthDestination, useHasOnboarded } from "../paths";
import {
  invalidateDelegationCardsForIssue,
  invalidateDelegationCardsForIssueId,
  syncTeamMessageCreated,
} from "./delegation-card-invalidation";
import type {
  MemberAddedPayload,
  WorkspaceDeletedPayload,
  MemberRemovedPayload,
  IssueUpdatedPayload,
  IssueCreatedPayload,
  IssueDeletedPayload,
  IssueLabelsChangedPayload,
  InboxNewPayload,
  CommentCreatedPayload,
  CommentUpdatedPayload,
  CommentDeletedPayload,
  ActivityCreatedPayload,
  ReactionAddedPayload,
  ReactionRemovedPayload,
  IssueReactionAddedPayload,
  IssueReactionRemovedPayload,
  SubscriberAddedPayload,
  SubscriberRemovedPayload,
  TaskMessagePayload,
  TaskQueuedPayload,
  TaskDispatchPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
  TaskCancelledPayload,
  ChatDonePayload,
  ChatPendingTask,
  InvitationCreatedPayload,
  ListMeetingASRJobsResponse,
  ListMeetingInsightCardsResponse,
  ListMeetingTranscriptSegmentsResponse,
  MeetingASRJob,
  TeamMessageCreatedPayload,
  AgentMemoryCreatedPayload,
  AgentSkillCandidateCreatedPayload,
  AgentEventCreatedPayload,
  MeetingInsightCardPayload,
  MeetingSessionPayload,
  MeetingSummaryCreatedPayload,
  MeetingTranscriptSegmentCreatedPayload,
  MeetingTranscriptSegmentDeletedPayload,
  MeetingTranscriptSegmentUpdatedPayload,
  TaskMessageChunkPayload,
  TaskMessageCompletePayload,
  ListRoomMessagesResponse,
  RoomMessagePayload,
} from "../types";
import { useRoomsStore } from "../rooms/store";
import { roomKeys } from "../rooms/queries";

const chatWsLogger = createLogger("chat.ws");

const logger = createLogger("realtime-sync");

export interface RealtimeSyncStores {
  authStore: UseBoundStore<StoreApi<AuthState>>;
}

/**
 * Centralized WS -> store sync. Called once from WSProvider.
 *
 * Uses the "WS as invalidation signal + refetch" pattern:
 * - onAny handler extracts event prefix and calls the matching store refresh
 * - Debounce per-prefix prevents rapid-fire refetches (e.g. bulk issue updates)
 * - Precise handlers only for side effects (toast, navigation, self-check)
 *
 * Per-issue events (comments, activity, reactions, subscribers) are handled
 * both here (invalidation fallback) and by per-page useWSEvent hooks (granular
 * updates). Daemon register events invalidate runtimes globally; heartbeats
 * are skipped to avoid excessive refetches.
 *
 * @param ws - WebSocket client instance (null when not yet connected)
 * @param stores - Platform-created Zustand store instances for auth and workspace
 * @param onToast - Optional callback for showing toast messages (platform-specific)
 */
export function useRealtimeSync(
  ws: WSClient | null,
  stores: RealtimeSyncStores,
  onToast?: (message: string, type?: "info" | "error") => void,
) {
  const { authStore } = stores;
  const qc = useQueryClient();

  // Captured via ref so the (rare) hasOnboarded change doesn't re-subscribe
  // every WS handler in this effect. The resolver reads `.current` at the
  // moment workspace-loss fires, which is what we want.
  const hasOnboarded = useHasOnboarded();
  const hasOnboardedRef = useRef(hasOnboarded);
  hasOnboardedRef.current = hasOnboarded;

  // Main sync: onAny -> refreshMap with debounce
  useEffect(() => {
    if (!ws) return;

    const refreshMap: Record<string, () => void> = {
      inbox: () => {
        const wsId = getCurrentWsId();
        if (wsId) onInboxInvalidate(qc, wsId);
      },
      agent: () => {
        const wsId = getCurrentWsId();
        if (wsId) qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      },
      member: () => {
        const wsId = getCurrentWsId();
        if (wsId) qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) });
      },
      workspace: () => {
        qc.invalidateQueries({ queryKey: workspaceKeys.list() });
      },
      skill: () => {
        const wsId = getCurrentWsId();
        if (wsId) qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
      },
      project: () => {
        const wsId = getCurrentWsId();
        if (wsId) {
          qc.invalidateQueries({ queryKey: projectKeys.all(wsId) });
          qc.invalidateQueries({ queryKey: projectV12Keys.all(wsId) });
        }
      },
      label: () => {
        // label:created/updated/deleted — also refresh issues, since each
        // issue carries a denormalized snapshot of its labels (rename/recolor
        // /delete on a label needs to flush the chips on every issue showing
        // it).
        const wsId = getCurrentWsId();
        if (wsId) {
          qc.invalidateQueries({ queryKey: ["labels", wsId] });
          qc.invalidateQueries({ queryKey: issueKeys.all(wsId) });
        }
      },
      pin: () => {
        const wsId = getCurrentWsId();
        const userId = authStore.getState().user?.id;
        if (wsId && userId) qc.invalidateQueries({ queryKey: pinKeys.all(wsId, userId) });
      },
      daemon: () => {
        const wsId = getCurrentWsId();
        if (wsId) qc.invalidateQueries({ queryKey: runtimeKeys.all(wsId) });
      },
      autopilot: () => {
        const wsId = getCurrentWsId();
        if (wsId) qc.invalidateQueries({ queryKey: autopilotKeys.all(wsId) });
      },
      mission: () => {
        const wsId = getCurrentWsId();
        if (wsId) qc.invalidateQueries({ queryKey: missionKeys.all(wsId) });
      },
      team: () => {
        const wsId = getCurrentWsId();
        if (wsId) qc.invalidateQueries({ queryKey: teamKeys.all(wsId) });
      },
      // Powers the agent presence cache: any task lifecycle change
      // (dispatch / completed / failed / cancelled) refreshes the
      // workspace-wide agent-task-snapshot query so per-agent presence
      // reflects the change. task:message is NOT in this prefix path — it
      // stays in specificEvents to avoid an invalidate storm during long runs.
      task: () => {
        const wsId = getCurrentWsId();
        if (!wsId) return;
        qc.invalidateQueries({ queryKey: agentTaskSnapshotKeys.list(wsId) });
        // 30d activity series shares the same lifecycle signal — any task
        // completion / failure shifts the histogram. (Dispatch alone
        // doesn't change a completed_at-anchored series, but invalidating
        // here keeps the WS-handler shape uniform; the resulting refetch
        // is cheap.) Both the list (trailing 7d slice) and the detail
        // panel read off this single cache.
        qc.invalidateQueries({ queryKey: agentActivityKeys.last365d(wsId) });
        // 30-day run count likewise increments per task lifecycle event.
        qc.invalidateQueries({ queryKey: agentRunCountsKeys.last30d(wsId) });
        // Per-agent task list (Activity tab "Recent work"). Prefix match
        // catches every agent's list — the per-agent detail key sits
        // under agentTasks/<wsId>/<agentId>.
        qc.invalidateQueries({ queryKey: agentTasksKeys.all(wsId) });
        // Per-issue task list (issue-detail Execution log). Prefix match
        // across all issues — keeps the contract "any task: event makes
        // every list-of-tasks query stale" so cache stays fresh even
        // when the relevant component isn't currently mounted.
        qc.invalidateQueries({ queryKey: ["issues", "tasks"] });
      },
    };

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const debouncedRefresh = (prefix: string, fn: () => void) => {
      const existing = timers.get(prefix);
      if (existing) clearTimeout(existing);
      timers.set(
        prefix,
        setTimeout(() => {
          timers.delete(prefix);
          fn();
        }, 100),
      );
    };

    // Event types handled by specific handlers below -- skip generic refresh
    const specificEvents = new Set([
      "issue:updated", "issue:created", "issue:deleted", "issue_labels:changed", "inbox:new",
      "comment:created", "comment:updated", "comment:deleted",
      "activity:created",
      "reaction:added", "reaction:removed",
      "issue_reaction:added", "issue_reaction:removed",
      "subscriber:added", "subscriber:removed",
      "daemon:heartbeat",
      // Chat events are handled explicitly below; do not double-invalidate.
      "chat:message", "chat:done", "chat:session_read",
      // task:message stays out of the prefix path because it fires per
      // streamed message during a long run — invalidating the snapshot on
      // every message would flood the network. Specific chat handlers below
      // still receive it via ws.on() (a separate subscription channel).
      "task:message",
      // task:message_chunk / task:message_complete are high-frequency streaming
      // events — keeping them out of onAny prevents an invalidate storm.
      "task:message_chunk",
      "task:message_complete",
      // room:message is handled by a specific handler below.
      "room:message",
      "team:message_created",
      "meeting:created",
      "meeting:updated",
      "meeting:started",
      "meeting:stopped",
      "meeting:deleted",
      "meeting:transcript_segment_created",
      "meeting:transcript_segment_updated",
      "meeting:transcript_segment_deleted",
      "meeting:asr_job_updated",
      "meeting:insight_created",
      "meeting:insight_updated",
      "meeting:strong_alert_created",
      "meeting:summary_created",
      "meeting:analysis_status_updated",
      // task:completed / task:failed deliberately NOT here. They go through
      // both the task-prefix invalidate (refreshes the agent-task-snapshot
      // cache) AND the chat-specific ws.on() handlers below. The two
      // channels are independent — onAny dispatch and ws.on are separate
      // subscriptions.
    ]);

    const unsubAny = ws.onAny((msg) => {
      if (specificEvents.has(msg.type)) return;
      const prefix = msg.type.split(":")[0] ?? "";
      const refresh = refreshMap[prefix];
      if (refresh) debouncedRefresh(prefix, refresh);
    });

    // --- Specific event handlers (granular cache updates) ---
    // No self-event filtering: actor_id identifies the USER, not the TAB.
    // Filtering by actor_id would block other tabs of the same user.
    // Instead, both mutations and WS handlers use dedup checks to be idempotent.

    const unsubIssueUpdated = ws.on("issue:updated", (p) => {
      const { issue } = p as IssueUpdatedPayload;
      if (!issue?.id) return;
      const wsId = getCurrentWsId();
      if (wsId) {
        onIssueUpdated(qc, wsId, issue);
        invalidateDelegationCardsForIssue(qc, wsId, issue);
        if (issue.status) {
          onInboxIssueStatusChanged(qc, wsId, issue.id, issue.status);
        }
      }
    });

    const unsubIssueCreated = ws.on("issue:created", (p) => {
      const { issue } = p as IssueCreatedPayload;
      if (!issue) return;
      const wsId = getCurrentWsId();
      if (wsId) onIssueCreated(qc, wsId, issue);
    });

    const unsubIssueDeleted = ws.on("issue:deleted", (p) => {
      const { issue_id } = p as IssueDeletedPayload;
      if (!issue_id) return;
      const wsId = getCurrentWsId();
      if (wsId) {
        invalidateDelegationCardsForIssueId(qc, wsId, issue_id);
        onIssueDeleted(qc, wsId, issue_id);
        onInboxIssueDeleted(qc, wsId, issue_id);
      }
    });

    const unsubIssueLabelsChanged = ws.on("issue_labels:changed", (p) => {
      const { issue_id, labels } = p as IssueLabelsChangedPayload;
      if (!issue_id) return;
      const wsId = getCurrentWsId();
      if (wsId) onIssueLabelsChanged(qc, wsId, issue_id, labels ?? []);
    });

    const handleMeetingChanged = (p: unknown) => {
      const { meeting } = p as MeetingSessionPayload;
      const wsId = getCurrentWsId();
      if (!wsId || !meeting?.id) return;
      qc.setQueryData(meetingKeys.detail(wsId, meeting.id), meeting);
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, meeting.project_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId) });
    };

    const unsubMeetingCreated = ws.on("meeting:created", handleMeetingChanged);
    const unsubMeetingUpdated = ws.on("meeting:updated", handleMeetingChanged);
    const unsubMeetingStarted = ws.on("meeting:started", handleMeetingChanged);
    const unsubMeetingStopped = ws.on("meeting:stopped", handleMeetingChanged);
    const unsubMeetingDeleted = ws.on("meeting:deleted", (p) => {
      const { meeting_id, project_id } = p as { meeting_id?: string; project_id?: string };
      const wsId = getCurrentWsId();
      if (!wsId || !meeting_id) return;
      qc.removeQueries({ queryKey: meetingKeys.detail(wsId, meeting_id) });
      qc.removeQueries({ queryKey: meetingKeys.transcript(wsId, meeting_id) });
      qc.removeQueries({ queryKey: meetingKeys.insights(wsId, meeting_id) });
      qc.removeQueries({ queryKey: meetingKeys.summary(wsId, meeting_id) });
      qc.removeQueries({ queryKey: meetingKeys.audioAssets(wsId, meeting_id) });
      qc.removeQueries({ queryKey: meetingKeys.asrJobs(wsId, meeting_id) });
      if (project_id) qc.invalidateQueries({ queryKey: meetingKeys.list(wsId, project_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.list(wsId) });
    });

    const upsertMeetingTranscriptSegment = (
      payload: MeetingTranscriptSegmentCreatedPayload | MeetingTranscriptSegmentUpdatedPayload,
    ) => {
      const wsId = getCurrentWsId();
      if (!wsId || !payload.meeting_id || !payload.segment?.id) return;
      qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
        meetingKeys.transcript(wsId, payload.meeting_id),
        (old) => {
          if (!old) return old;
          const segments = [
            ...old.segments.filter((segment) => segment.id !== payload.segment.id),
            payload.segment,
          ].sort((a, b) => a.seq - b.seq);
          return { segments, total: segments.length };
        },
      );
    };

    const unsubMeetingTranscriptSegmentCreated = ws.on(
      "meeting:transcript_segment_created",
      (p) => upsertMeetingTranscriptSegment(p as MeetingTranscriptSegmentCreatedPayload),
    );
    const unsubMeetingTranscriptSegmentUpdated = ws.on(
      "meeting:transcript_segment_updated",
      (p) => {
        const payload = p as MeetingTranscriptSegmentUpdatedPayload;
        upsertMeetingTranscriptSegment(payload);
        const wsId = getCurrentWsId();
        if (!wsId || !payload.meeting_id) return;
        qc.invalidateQueries({ queryKey: meetingKeys.summary(wsId, payload.meeting_id) });
        qc.invalidateQueries({ queryKey: meetingKeys.insights(wsId, payload.meeting_id) });
      },
    );
    const unsubMeetingTranscriptSegmentDeleted = ws.on(
      "meeting:transcript_segment_deleted",
      (p) => {
        const payload = p as MeetingTranscriptSegmentDeletedPayload;
        const wsId = getCurrentWsId();
        if (!wsId || !payload.meeting_id || !payload.segment_id) return;
        qc.setQueryData<ListMeetingTranscriptSegmentsResponse>(
          meetingKeys.transcript(wsId, payload.meeting_id),
          (old) => {
            if (!old) return old;
            const segments = old.segments.filter((segment) => segment.id !== payload.segment_id);
            return { segments, total: segments.length };
          },
        );
        qc.invalidateQueries({ queryKey: meetingKeys.summary(wsId, payload.meeting_id) });
        qc.invalidateQueries({ queryKey: meetingKeys.insights(wsId, payload.meeting_id) });
      },
    );

    const unsubMeetingASRJobUpdated = ws.on("meeting:asr_job_updated", (p) => {
      const payload = p as { meeting_id?: string; job?: MeetingASRJob };
      const wsId = getCurrentWsId();
      if (!wsId || !payload.meeting_id || !payload.job?.id) return;
      qc.setQueryData<ListMeetingASRJobsResponse>(
        meetingKeys.asrJobs(wsId, payload.meeting_id),
        (old) => {
          const existingJobs = old?.jobs ?? [];
          const jobs = [
            payload.job!,
            ...existingJobs.filter((job) => job.id !== payload.job!.id),
          ];
          return { jobs, total: jobs.length };
        },
      );
      qc.invalidateQueries({ queryKey: meetingKeys.asrJobs(wsId, payload.meeting_id) });
      if (payload.job.status === "completed") {
        qc.invalidateQueries({ queryKey: meetingKeys.transcript(wsId, payload.meeting_id) });
        qc.invalidateQueries({ queryKey: meetingKeys.insights(wsId, payload.meeting_id) });
        qc.invalidateQueries({ queryKey: meetingKeys.summary(wsId, payload.meeting_id) });
      }
    });

    const upsertMeetingInsight = (payload: MeetingInsightCardPayload) => {
      const wsId = getCurrentWsId();
      if (!wsId || !payload.meeting_id || !payload.card?.id) return;
      qc.setQueryData<ListMeetingInsightCardsResponse>(
        meetingKeys.insights(wsId, payload.meeting_id),
        (old) => {
          if (!old) return old;
          const withoutExisting = old.cards.filter((card) => card.id !== payload.card.id);
          const severityOrder: Record<string, number> = { L3: 0, L2: 1, L1: 2 };
          const cards = [payload.card, ...withoutExisting].sort(
            (a, b) =>
              (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3) ||
              b.created_at.localeCompare(a.created_at),
          );
          return { cards, total: cards.length };
        },
      );
    };

    const unsubMeetingInsightCreated = ws.on("meeting:insight_created", (p) =>
      upsertMeetingInsight(p as MeetingInsightCardPayload),
    );
    const unsubMeetingInsightUpdated = ws.on("meeting:insight_updated", (p) =>
      upsertMeetingInsight(p as MeetingInsightCardPayload),
    );
    const unsubMeetingStrongAlertCreated = ws.on("meeting:strong_alert_created", (p) =>
      upsertMeetingInsight(p as MeetingInsightCardPayload),
    );
    const unsubMeetingSummaryCreated = ws.on("meeting:summary_created", (p) => {
      const { meeting_id } = p as MeetingSummaryCreatedPayload;
      const wsId = getCurrentWsId();
      if (!wsId || !meeting_id) return;
      qc.invalidateQueries({ queryKey: meetingKeys.detail(wsId, meeting_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.insights(wsId, meeting_id) });
      qc.invalidateQueries({ queryKey: meetingKeys.summary(wsId, meeting_id) });
    });
    const unsubMeetingAnalysisStatusUpdated = ws.on("meeting:analysis_status_updated", handleMeetingChanged);

    const unsubInboxNew = ws.on("inbox:new", (p) => {
      const { item } = p as InboxNewPayload;
      if (!item) return;
      const wsId = getCurrentWsId();
      if (wsId) onInboxNew(qc, wsId, item);
      // Fire a native OS notification only when the app isn't focused. When
      // the user is already looking at Multica, the inbox sidebar's unread
      // styling is enough — no need to interrupt with a banner. `desktopAPI`
      // is injected by the preload script; its absence (web app) skips silently.
      if (typeof document !== "undefined" && document.hasFocus()) return;
      // Capture the source workspace slug at emit time. The user may switch
      // workspaces before clicking the banner (macOS Notification Center
      // holds banners), so routing must not read "current slug" at click
      // time — otherwise notifications from workspace A click through to
      // workspace B's inbox and 404.
      const slug = getCurrentSlug();
      if (!slug) return;
      const desktopAPI = (
        window as unknown as {
          desktopAPI?: {
            showNotification?: (payload: {
              slug: string;
              itemId: string;
              issueKey: string;
              title: string;
              body: string;
            }) => void;
          };
        }
      ).desktopAPI;
      // `issueKey` matches the inbox page's URL selector (issue id when the
      // item is attached to an issue, otherwise the inbox item id). `itemId`
      // is the inbox row's own id, needed to fire markInboxRead on click.
      desktopAPI?.showNotification?.({
        slug,
        itemId: item.id,
        issueKey: item.issue_id ?? item.id,
        title: item.title,
        body: item.body ?? "",
      });
    });

    // --- Timeline event handlers (global fallback) ---
    // These events are also handled granularly by useIssueTimeline when
    // IssueDetail is mounted. This global handler ensures the timeline cache
    // is invalidated even when IssueDetail is unmounted, so stale data
    // isn't served on next mount (staleTime: Infinity relies on this).

    const invalidateTimeline = (issueId: string) => {
      qc.invalidateQueries({ queryKey: issueKeys.timeline(issueId) });
    };
    const invalidateDelegationCardsByIssueId = (
      issueId: string,
      source?: { source_team_message_id?: string | null },
    ) => {
      const wsId = getCurrentWsId();
      if (wsId) invalidateDelegationCardsForIssueId(qc, wsId, issueId, source);
    };

    const unsubCommentCreated = ws.on("comment:created", (p) => {
      const { comment } = p as CommentCreatedPayload;
      if (comment?.issue_id) {
        invalidateTimeline(comment.issue_id);
        invalidateDelegationCardsByIssueId(comment.issue_id, p as CommentCreatedPayload);
      }
    });

    const unsubCommentUpdated = ws.on("comment:updated", (p) => {
      const { comment } = p as CommentUpdatedPayload;
      if (comment?.issue_id) {
        invalidateTimeline(comment.issue_id);
        invalidateDelegationCardsByIssueId(comment.issue_id, p as CommentUpdatedPayload);
      }
    });

    const unsubCommentDeleted = ws.on("comment:deleted", (p) => {
      const { issue_id } = p as CommentDeletedPayload;
      if (issue_id) {
        invalidateTimeline(issue_id);
        invalidateDelegationCardsByIssueId(issue_id, p as CommentDeletedPayload);
      }
    });

    const unsubActivityCreated = ws.on("activity:created", (p) => {
      const { issue_id } = p as ActivityCreatedPayload;
      if (issue_id) {
        invalidateTimeline(issue_id);
        invalidateDelegationCardsByIssueId(issue_id, p as ActivityCreatedPayload);
      }
    });

    const unsubReactionAdded = ws.on("reaction:added", (p) => {
      const { issue_id } = p as ReactionAddedPayload;
      if (issue_id) {
        invalidateTimeline(issue_id);
        invalidateDelegationCardsByIssueId(issue_id, p as ReactionAddedPayload);
      }
    });

    const unsubReactionRemoved = ws.on("reaction:removed", (p) => {
      const { issue_id } = p as ReactionRemovedPayload;
      if (issue_id) {
        invalidateTimeline(issue_id);
        invalidateDelegationCardsByIssueId(issue_id, p as ReactionRemovedPayload);
      }
    });

    // --- Issue-level reactions & subscribers (global fallback) ---

    const unsubIssueReactionAdded = ws.on("issue_reaction:added", (p) => {
      const { issue_id } = p as IssueReactionAddedPayload;
      if (issue_id) {
        qc.invalidateQueries({ queryKey: issueKeys.reactions(issue_id) });
        invalidateDelegationCardsByIssueId(issue_id, p as IssueReactionAddedPayload);
      }
    });

    const unsubIssueReactionRemoved = ws.on("issue_reaction:removed", (p) => {
      const { issue_id } = p as IssueReactionRemovedPayload;
      if (issue_id) {
        qc.invalidateQueries({ queryKey: issueKeys.reactions(issue_id) });
        invalidateDelegationCardsByIssueId(issue_id, p as IssueReactionRemovedPayload);
      }
    });

    const unsubSubscriberAdded = ws.on("subscriber:added", (p) => {
      const { issue_id } = p as SubscriberAddedPayload;
      if (issue_id) {
        qc.invalidateQueries({ queryKey: issueKeys.subscribers(issue_id) });
        invalidateDelegationCardsByIssueId(issue_id, p as SubscriberAddedPayload);
      }
    });

    const unsubSubscriberRemoved = ws.on("subscriber:removed", (p) => {
      const { issue_id } = p as SubscriberRemovedPayload;
      if (issue_id) {
        qc.invalidateQueries({ queryKey: issueKeys.subscribers(issue_id) });
        invalidateDelegationCardsByIssueId(issue_id, p as SubscriberRemovedPayload);
      }
    });

    // --- Side-effect handlers (toast, navigation) ---

    // After the current workspace disappears (deleted or we were kicked out),
    // navigate to another workspace the user still has access to, or to the
    // create-workspace page. We use a full-page navigation: this reliably
    // tears down any in-flight queries / subscriptions tied to the dead
    // workspace without relying on framework-specific routers from here in
    // core.
    const relocateAfterWorkspaceLoss = async (lostWsId: string) => {
      const wsList = await qc.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });
      const remaining = wsList.filter((w) => w.id !== lostWsId);
      const target = resolvePostAuthDestination(
        remaining,
        hasOnboardedRef.current,
      );
      if (typeof window !== "undefined") {
        window.location.assign(target);
      }
    };

    const unsubWsDeleted = ws.on("workspace:deleted", (p) => {
      const { workspace_id } = p as WorkspaceDeletedPayload;
      // Event payload has UUID; look up slug from cached workspace list
      // since clearWorkspaceStorage keys are namespaced by slug.
      const wsList = qc.getQueryData<{ id: string; slug: string }[]>(workspaceKeys.list()) ?? [];
      const deletedSlug = wsList.find((w) => w.id === workspace_id)?.slug;
      if (deletedSlug) clearWorkspaceStorage(defaultStorage, deletedSlug);
      if (getCurrentWsId() === workspace_id) {
        logger.warn("current workspace deleted, switching");
        onToast?.("This workspace was deleted", "info");
        relocateAfterWorkspaceLoss(workspace_id);
      }
    });

    const unsubMemberRemoved = ws.on("member:removed", (p) => {
      const { user_id } = p as MemberRemovedPayload;
      const myUserId = authStore.getState().user?.id;
      if (user_id === myUserId) {
        const slug = getCurrentSlug();
        const wsId = getCurrentWsId();
        if (slug && wsId) {
          clearWorkspaceStorage(defaultStorage, slug);
          logger.warn("removed from workspace, switching");
          onToast?.("You were removed from this workspace", "info");
          relocateAfterWorkspaceLoss(wsId);
        }
      }
    });

    const unsubMemberAdded = ws.on("member:added", (p) => {
      const { member, workspace_name } = p as MemberAddedPayload;
      const myUserId = authStore.getState().user?.id;
      if (member.user_id === myUserId) {
        qc.invalidateQueries({ queryKey: workspaceKeys.list() });
        qc.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
        onToast?.(
          `You joined ${workspace_name ?? "a workspace"}`,
          "info",
        );
      }
    });

    // invitation:created — notify the invitee of a new pending invitation
    const unsubInvitationCreated = ws.on("invitation:created", (p) => {
      const { workspace_name } = p as InvitationCreatedPayload;
      qc.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
      onToast?.(
        `You were invited to ${workspace_name ?? "a workspace"}`,
        "info",
      );
    });

    // invitation:accepted / declined / revoked — refresh invitation lists
    const unsubInvitationAccepted = ws.on("invitation:accepted", () => {
      const currentWsId = getCurrentWsId();
      if (currentWsId) {
        qc.invalidateQueries({ queryKey: workspaceKeys.invitations(currentWsId) });
        qc.invalidateQueries({ queryKey: workspaceKeys.members(currentWsId) });
      }
    });
    const unsubInvitationDeclined = ws.on("invitation:declined", () => {
      const currentWsId = getCurrentWsId();
      if (currentWsId) {
        qc.invalidateQueries({ queryKey: workspaceKeys.invitations(currentWsId) });
      }
    });
    const unsubInvitationRevoked = ws.on("invitation:revoked", () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
    });

    // --- Chat / task events (global, survives ChatWindow unmount) ---
    //
    // Single source of truth: the Query cache. No Zustand writes here — the
    // earlier mirror caused a race where the cache and store disagreed
    // during the invalidate → refetch window and the UI rendered duplicates.
    //
    // task:message is written directly into the task-messages cache so the
    // live timeline updates in place. chat:message / chat:done /
    // task:completed / task:failed invalidate messages + pending-task so the
    // DB remains authoritative.

    const unsubTaskMessage = ws.on("task:message", (p) => {
      const payload = p as TaskMessagePayload;
      qc.setQueryData<TaskMessagePayload[]>(
        ["task-messages", payload.task_id],
        (old = []) => {
          if (old.some((m) => m.seq === payload.seq)) return old;
          return [...old, payload].sort((a, b) => a.seq - b.seq);
        },
      );
      chatWsLogger.debug("task:message (global)", {
        task_id: payload.task_id,
        seq: payload.seq,
        type: payload.type,
      });
    });

    // v1.0.14 — streaming chunk for room messages. High-frequency: write into
    // Zustand chunk buffer only, do NOT invalidate any query cache here.
    const unsubTaskMessageChunk = ws.on("task:message_chunk", (p) => {
      const payload = p as TaskMessageChunkPayload;
      useRoomsStore.getState().appendChunk(payload.message_id, payload.chunk);
    });

    // v1.0.14 — stream complete: clear chunk buffer, invalidate room messages
    // cache so persisted message shows up, and also invalidate task-messages
    // cache using the same pattern as the existing task:message handler.
    const unsubTaskMessageComplete = ws.on("task:message_complete", (p) => {
      const payload = p as TaskMessageCompletePayload;
      useRoomsStore.getState().completeMessage(payload.message_id, payload.content);
      qc.invalidateQueries({ queryKey: ["task-messages", payload.task_id] });
      chatWsLogger.debug("task:message_complete", {
        task_id: payload.task_id,
        message_id: payload.message_id,
      });
    });

    // v1.0.14 — new room message: invalidate message list for that room.
    const unsubRoomMessage = ws.on("room:message", (p) => {
      const payload = p as RoomMessagePayload;
      qc.setQueryData<ListRoomMessagesResponse>(
        roomKeys.messages(payload.room_id),
        (old) => {
          const message = {
            id: payload.message_id,
            room_id: payload.room_id,
            sender_type: payload.sender_type,
            sender_id: payload.sender_id,
            sender_name: payload.sender_name ?? null,
            content: payload.content,
            reply_to_message_id: payload.reply_to_message_id ?? null,
            mentions: payload.mentions ?? [],
            is_autonomous: payload.is_autonomous,
            created_at: payload.created_at,
          };
          const current = old ?? { messages: [] };
          if (current.messages.some((m) => m.id === message.id)) {
            return current;
          }
          return {
            ...current,
            messages: [...current.messages, message].sort((a, b) =>
              a.created_at.localeCompare(b.created_at),
            ),
          };
        },
      );
      qc.invalidateQueries({ queryKey: roomKeys.messages(payload.room_id) });
    });

    // Helpers reused by chat lifecycle handlers.
    const invalidatePendingAggregate = () => {
      const id = getCurrentWsId();
      if (id) qc.invalidateQueries({ queryKey: chatKeys.pendingTasks(id) });
    };
    const invalidateSessionLists = () => {
      const id = getCurrentWsId();
      if (id) {
        qc.invalidateQueries({ queryKey: chatKeys.sessions(id) });
        qc.invalidateQueries({ queryKey: chatKeys.allSessions(id) });
      }
    };

    const unsubChatMessage = ws.on("chat:message", (p) => {
      const payload = p as { chat_session_id: string };
      chatWsLogger.info("chat:message (global)", { chat_session_id: payload.chat_session_id });
      qc.invalidateQueries({ queryKey: chatKeys.messages(payload.chat_session_id) });
      qc.invalidateQueries({ queryKey: chatKeys.pendingTask(payload.chat_session_id) });
      invalidatePendingAggregate();
    });

    const unsubChatDone = ws.on("chat:done", (p) => {
      const payload = p as ChatDonePayload;
      chatWsLogger.info("chat:done (global)", {
        task_id: payload.task_id,
        chat_session_id: payload.chat_session_id,
      });
      // Assistant message was just written and task flipped out of 'running'.
      // Clear pending-task cache immediately so the live-timeline-vs-assistant
      // race window collapses to zero — the subsequent refetch will confirm.
      qc.setQueryData(chatKeys.pendingTask(payload.chat_session_id), {});
      qc.invalidateQueries({ queryKey: chatKeys.messages(payload.chat_session_id) });
      qc.invalidateQueries({ queryKey: chatKeys.pendingTask(payload.chat_session_id) });
      invalidatePendingAggregate();
      // Assistant message just landed → has_unread may have flipped to true.
      invalidateSessionLists();
    });

    // Chat task lifecycle writethrough: keep `chatKeys.pendingTask(sessionId)`
    // synchronized with the server state machine via setQueryData rather than
    // invalidate-refetch. Same pattern as task:message — the WS payload
    // carries everything we need, and an HTTP roundtrip just to read what we
    // already know would add latency to every stage transition.
    //
    // task:queued is emitted by EnqueueChatTask. The optimistic seed in
    // chat-window.tsx may have already populated the cache with a temporary
    // id; this handler upgrades it to the real task_id (and reaffirms status
    // when reconnect replays the event for an already-running task).
    const unsubTaskQueued = ws.on("task:queued", (p) => {
      const payload = p as TaskQueuedPayload;
      if (!payload.chat_session_id) return;
      qc.setQueryData<ChatPendingTask>(
        chatKeys.pendingTask(payload.chat_session_id),
        (old) => ({
          ...(old ?? {}),
          task_id: payload.task_id,
          status: "queued",
        }),
      );
      invalidatePendingAggregate();
    });

    // task:dispatch fires when the daemon claims the queued task. The daemon
    // immediately follows with StartTask, so dispatched→running is sub-second.
    // We collapse that window by writing "running" directly — the pill jumps
    // from "Queued" straight to "Thinking", skipping a meaningless "Starting"
    // frame. Stage decision in TaskStatusPill maps "running" + empty
    // taskMessages → "Thinking · Ns".
    const unsubTaskDispatch = ws.on("task:dispatch", (p) => {
      const payload = p as TaskDispatchPayload;
      if (!payload.chat_session_id) return;
      qc.setQueryData<ChatPendingTask>(
        chatKeys.pendingTask(payload.chat_session_id),
        (old) => {
          if (!old || old.task_id !== payload.task_id) return old;
          return { ...old, status: "running" };
        },
      );
    });

    // task:cancelled reaches us when:
    //   1. handleStop already cleared the cache locally (this is a no-op confirm)
    //   2. another tab / admin / system cancels — this is the only path that
    //      drops the pending pill in those cases. Without it the pill spins
    //      forever in the second-tab scenario.
    const unsubTaskCancelled = ws.on("task:cancelled", (p) => {
      const payload = p as TaskCancelledPayload;
      if (!payload.chat_session_id) return;
      chatWsLogger.info("task:cancelled (global, chat)", {
        task_id: payload.task_id,
        chat_session_id: payload.chat_session_id,
      });
      qc.setQueryData(chatKeys.pendingTask(payload.chat_session_id), {});
      invalidatePendingAggregate();
    });

    const unsubTaskCompleted = ws.on("task:completed", (p) => {
      const payload = p as TaskCompletedPayload;
      if (!payload.chat_session_id) return; // issue tasks handled elsewhere
      chatWsLogger.info("task:completed (global, chat)", {
        task_id: payload.task_id,
        chat_session_id: payload.chat_session_id,
      });
      qc.setQueryData(chatKeys.pendingTask(payload.chat_session_id), {});
      qc.invalidateQueries({ queryKey: chatKeys.messages(payload.chat_session_id) });
      qc.invalidateQueries({ queryKey: chatKeys.pendingTask(payload.chat_session_id) });
      invalidatePendingAggregate();
    });

    const unsubTaskFailed = ws.on("task:failed", (p) => {
      const payload = p as TaskFailedPayload;
      if (!payload.chat_session_id) return;
      chatWsLogger.warn("task:failed (global, chat)", {
        task_id: payload.task_id,
        chat_session_id: payload.chat_session_id,
      });
      // FailTask writes a failure chat_message (mirroring CompleteTask's
      // success message), so this path mirrors the task:completed handler:
      // clear the pending signal AND invalidate the messages list so the
      // failure bubble shows up without requiring a page refresh. Pre-#1823
      // this branch only flipped pending — the comment "No new message"
      // was true then, but FailTask now persists a row.
      qc.setQueryData(chatKeys.pendingTask(payload.chat_session_id), {});
      qc.invalidateQueries({ queryKey: chatKeys.messages(payload.chat_session_id) });
      qc.invalidateQueries({ queryKey: chatKeys.pendingTask(payload.chat_session_id) });
      invalidatePendingAggregate();
    });

    const unsubChatSessionRead = ws.on("chat:session_read", (p) => {
      const payload = p as { chat_session_id: string };
      chatWsLogger.info("chat:session_read (global)", payload);
      invalidateSessionLists();
    });

    const unsubTeamMessageCreated = ws.on("team:message_created", (p) => {
      const payload = p as TeamMessageCreatedPayload;
      const wsId = getCurrentWsId();
      if (!wsId || !payload.team_id) return;
      syncTeamMessageCreated(qc, wsId, payload);
    });

    const unsubAgentMemoryCreated = ws.on("agent:memory_created", (p) => {
      const payload = p as AgentMemoryCreatedPayload;
      const wsId = getCurrentWsId();
      if (!wsId || !payload.agent_id) return;
      if (payload.memory) {
        qc.setQueryData<{ memories: typeof payload.memory[] }>(
          agentMemoryKeys.detail(wsId, payload.agent_id),
          (old) => {
            const current = old ?? { memories: [] };
            if (current.memories.some((m) => m.id === payload.memory!.id)) {
              return current;
            }
            return { memories: [payload.memory!, ...current.memories] };
          },
        );
      } else {
        qc.invalidateQueries({
          queryKey: agentMemoryKeys.detail(wsId, payload.agent_id),
        });
      }
    });

    const handleAgentMemoryChanged = (p: unknown) => {
      const payload = p as AgentMemoryCreatedPayload;
      const wsId = getCurrentWsId();
      if (!wsId || !payload.agent_id) return;
      if (!payload.memory) {
        qc.invalidateQueries({
          queryKey: agentMemoryKeys.detail(wsId, payload.agent_id),
        });
        return;
      }
      qc.setQueryData<{ memories: typeof payload.memory[] }>(
        agentMemoryKeys.detail(wsId, payload.agent_id),
        (old) => {
          const current = old ?? { memories: [] };
          if (payload.memory!.status === "rejected") {
            return {
              memories: current.memories.filter((m) => m.id !== payload.memory!.id),
            };
          }
          if (current.memories.some((m) => m.id === payload.memory!.id)) {
            return {
              memories: current.memories.map((m) =>
                m.id === payload.memory!.id ? payload.memory! : m,
              ),
            };
          }
          return { memories: [payload.memory!, ...current.memories] };
        },
      );
    };

    const unsubAgentMemoryConfirmed = ws.on("agent:memory_confirmed", handleAgentMemoryChanged);
    const unsubAgentMemoryRejected = ws.on("agent:memory_rejected", handleAgentMemoryChanged);

    const handleAgentSkillCandidateChanged = (p: unknown) => {
      const payload = p as AgentSkillCandidateCreatedPayload;
      const wsId = getCurrentWsId();
      if (!wsId || !payload.agent_id) return;
      if (!payload.candidate) {
        qc.invalidateQueries({
          queryKey: agentSkillCandidateKeys.detail(wsId, payload.agent_id),
        });
        return;
      }
      qc.setQueryData<{ candidates: typeof payload.candidate[] }>(
        agentSkillCandidateKeys.detail(wsId, payload.agent_id),
        (old) => {
          const current = old ?? { candidates: [] };
          if (payload.candidate!.status === "rejected") {
            return {
              candidates: current.candidates.filter(
                (c) => c.id !== payload.candidate!.id,
              ),
            };
          }
          if (current.candidates.some((c) => c.id === payload.candidate!.id)) {
            return {
              candidates: current.candidates.map((c) =>
                c.id === payload.candidate!.id ? payload.candidate! : c,
              ),
            };
          }
          return { candidates: [payload.candidate!, ...current.candidates] };
        },
      );
      if (payload.candidate.status === "confirmed") {
        qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
        qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
      }
    };

    const unsubAgentSkillCandidateCreated = ws.on("agent:skill_candidate_created", handleAgentSkillCandidateChanged);
    const unsubAgentSkillCandidateConfirmed = ws.on("agent:skill_candidate_confirmed", handleAgentSkillCandidateChanged);
    const unsubAgentSkillCandidateRejected = ws.on("agent:skill_candidate_rejected", handleAgentSkillCandidateChanged);

    const unsubAgentEventCreated = ws.on("agent:event_created", (p) => {
      const payload = p as AgentEventCreatedPayload;
      const wsId = getCurrentWsId();
      if (!wsId || !payload.agent_id) return;
      qc.invalidateQueries({
        queryKey: agentEventKeys.detail(wsId, payload.agent_id),
      });
    });

    return () => {
      unsubAny();
      unsubIssueUpdated();
      unsubIssueCreated();
      unsubIssueDeleted();
      unsubIssueLabelsChanged();
      unsubMeetingCreated();
      unsubMeetingUpdated();
      unsubMeetingStarted();
      unsubMeetingStopped();
      unsubMeetingDeleted();
      unsubMeetingTranscriptSegmentCreated();
      unsubMeetingTranscriptSegmentUpdated();
      unsubMeetingTranscriptSegmentDeleted();
      unsubMeetingASRJobUpdated();
      unsubMeetingInsightCreated();
      unsubMeetingInsightUpdated();
      unsubMeetingStrongAlertCreated();
      unsubMeetingSummaryCreated();
      unsubMeetingAnalysisStatusUpdated();
      unsubInboxNew();
      unsubCommentCreated();
      unsubCommentUpdated();
      unsubCommentDeleted();
      unsubActivityCreated();
      unsubReactionAdded();
      unsubReactionRemoved();
      unsubIssueReactionAdded();
      unsubIssueReactionRemoved();
      unsubSubscriberAdded();
      unsubSubscriberRemoved();
      unsubWsDeleted();
      unsubMemberRemoved();
      unsubMemberAdded();
      unsubInvitationCreated();
      unsubInvitationAccepted();
      unsubInvitationDeclined();
      unsubInvitationRevoked();
      unsubTaskMessage();
      unsubTaskMessageChunk();
      unsubTaskMessageComplete();
      unsubRoomMessage();
      unsubChatMessage();
      unsubChatDone();
      unsubTaskQueued();
      unsubTaskDispatch();
      unsubTaskCancelled();
      unsubTaskCompleted();
      unsubTaskFailed();
      unsubChatSessionRead();
      unsubTeamMessageCreated();
      unsubAgentMemoryCreated();
      unsubAgentMemoryConfirmed();
      unsubAgentMemoryRejected();
      unsubAgentSkillCandidateCreated();
      unsubAgentSkillCandidateConfirmed();
      unsubAgentSkillCandidateRejected();
      unsubAgentEventCreated();
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [ws, qc, authStore, onToast]);

  // Reconnect -> refetch all data to recover missed events
  useEffect(() => {
    if (!ws) return;

    const unsub = ws.onReconnect(async () => {
      logger.info("reconnected, refetching all data");
      try {
        const wsId = getCurrentWsId();
        if (wsId) {
          qc.invalidateQueries({ queryKey: issueKeys.all(wsId) });
          qc.invalidateQueries({ queryKey: inboxKeys.all(wsId) });
          qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
          qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) });
          qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
          qc.invalidateQueries({ queryKey: projectKeys.all(wsId) });
          qc.invalidateQueries({ queryKey: projectV12Keys.all(wsId) });
          qc.invalidateQueries({ queryKey: meetingKeys.all(wsId) });
          qc.invalidateQueries({ queryKey: runtimeKeys.all(wsId) });
          qc.invalidateQueries({ queryKey: autopilotKeys.all(wsId) });
          qc.invalidateQueries({ queryKey: agentTaskSnapshotKeys.all(wsId) });
          qc.invalidateQueries({ queryKey: agentActivityKeys.all(wsId) });
          qc.invalidateQueries({ queryKey: agentRunCountsKeys.all(wsId) });
        }
        qc.invalidateQueries({ queryKey: workspaceKeys.list() });
      } catch (e) {
        logger.error("reconnect refetch failed", e);
      }
    });

    return unsub;
  }, [ws, qc]);
}
