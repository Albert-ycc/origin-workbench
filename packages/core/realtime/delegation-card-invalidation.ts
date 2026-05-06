import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { issueKeys } from "../issues/queries";
import { teamKeys } from "../teams/queries";
import type {
  DelegationTaskCard,
  Issue,
  TeamMessage,
  TeamMessageCreatedPayload,
} from "../types";

export interface TeamMessageDelegationRefreshResult {
  skipTeamMessageRefresh: boolean;
}

type DelegationCardsCache =
  | { cards?: DelegationTaskCard[] | null }
  | DelegationTaskCard[]
  | undefined;
type TeamMessagesCache = {
  messages: TeamMessage[];
  next_cursor?: string | null;
};

function isDelegationTaskCard(value: unknown): value is DelegationTaskCard {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { issue_id?: unknown }).issue_id === "string"
  );
}

function getCardsFromCache(data: DelegationCardsCache): DelegationTaskCard[] {
  if (Array.isArray(data)) return data.filter(isDelegationTaskCard);
  if (data && Array.isArray(data.cards)) {
    return data.cards.filter(isDelegationTaskCard);
  }
  return [];
}

function getMessageIdFromDelegationCardsKey(
  queryKey: QueryKey,
  wsId: string,
): string | null {
  const [scope, workspaceId, bucket, messageId] = queryKey;
  if (
    scope === "teams" &&
    workspaceId === wsId &&
    bucket === "delegation-cards" &&
    typeof messageId === "string"
  ) {
    return messageId;
  }
  return null;
}

function invalidateDelegationCardsForMessageIds(
  qc: QueryClient,
  wsId: string,
  messageIds: Iterable<string>,
) {
  for (const messageId of new Set(messageIds)) {
    qc.invalidateQueries({
      queryKey: teamKeys.delegationCards(wsId, messageId),
    });
  }
}

function resolveDelegationSourceMessageIds(
  qc: QueryClient,
  wsId: string,
  issueId: string,
): Set<string> {
  const messageIds = new Set<string>();
  const detail = qc.getQueryData<Pick<Issue, "source_team_message_id">>(
    issueKeys.detail(wsId, issueId),
  );
  if (detail?.source_team_message_id) {
    messageIds.add(detail.source_team_message_id);
  }

  const cardQueries = qc.getQueriesData<DelegationCardsCache>({
    queryKey: teamKeys.delegationCardsAll(wsId),
  });
  for (const [queryKey, data] of cardQueries) {
    const queryMessageId = getMessageIdFromDelegationCardsKey(queryKey, wsId);
    for (const card of getCardsFromCache(data)) {
      if (card.issue_id !== issueId) continue;
      if (card.source_team_message_id) {
        messageIds.add(card.source_team_message_id);
      } else if (queryMessageId) {
        messageIds.add(queryMessageId);
      }
    }
  }

  return messageIds;
}

export function syncDelegationCardsForTeamMessageCreated(
  qc: QueryClient,
  wsId: string,
  payload: TeamMessageCreatedPayload,
): TeamMessageDelegationRefreshResult {
  const messageIds = new Set<string>();
  if (payload.source_team_message_id) {
    messageIds.add(payload.source_team_message_id);
  }
  if (payload.issue_id) {
    for (const messageId of resolveDelegationSourceMessageIds(
      qc,
      wsId,
      payload.issue_id,
    )) {
      messageIds.add(messageId);
    }
  }
  invalidateDelegationCardsForMessageIds(qc, wsId, messageIds);

  return {
    skipTeamMessageRefresh:
      payload.event === "team_task_completed" && !payload.message,
  };
}

function appendTeamMessage(
  old: TeamMessagesCache | undefined,
  message: TeamMessage,
): TeamMessagesCache {
  const current = old ?? { messages: [], next_cursor: null };
  if (current.messages.some((m) => m.id === message.id)) {
    return current;
  }
  return {
    ...current,
    messages: [...current.messages, message].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
  };
}

export function syncTeamMessageCreated(
  qc: QueryClient,
  wsId: string,
  payload: TeamMessageCreatedPayload,
) {
  const delegationRefresh = syncDelegationCardsForTeamMessageCreated(
    qc,
    wsId,
    payload,
  );
  if (delegationRefresh.skipTeamMessageRefresh) return;

  if (payload.message) {
    qc.setQueryData<TeamMessagesCache>(
      teamKeys.messages(wsId, payload.team_id),
      (old) => appendTeamMessage(old, payload.message!),
    );
    if (payload.project_id) {
      qc.setQueryData<TeamMessagesCache>(
        ["projects-v12", wsId, "main-chat-messages", payload.project_id],
        (old) => appendTeamMessage(old, payload.message!),
      );
    }
    return;
  }

  qc.invalidateQueries({ queryKey: teamKeys.messages(wsId, payload.team_id) });
  if (payload.project_id) {
    qc.invalidateQueries({
      queryKey: ["projects-v12", wsId, "main-chat-messages", payload.project_id],
    });
  }
}

export function invalidateDelegationCardsForIssue(
  qc: QueryClient,
  wsId: string,
  issue: Pick<Issue, "id" | "source_team_message_id">,
) {
  const messageIds = resolveDelegationSourceMessageIds(qc, wsId, issue.id);
  if (issue.source_team_message_id) {
    messageIds.add(issue.source_team_message_id);
  }
  invalidateDelegationCardsForMessageIds(qc, wsId, messageIds);
}

export function invalidateDelegationCardsForIssueId(
  qc: QueryClient,
  wsId: string,
  issueId: string,
) {
  invalidateDelegationCardsForMessageIds(
    qc,
    wsId,
    resolveDelegationSourceMessageIds(qc, wsId, issueId),
  );
}
