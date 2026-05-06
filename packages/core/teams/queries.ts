import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

const EMPTY_DELEGATION_CARD_POLL_MS = 12_000;
const emptyDelegationCardPollStartedAt = new Map<string, number>();

export const teamKeys = {
  all: (wsId: string) => ["teams", wsId] as const,
  list: (wsId: string, status: "active" | "archived" = "active") =>
    [...teamKeys.all(wsId), "list", status] as const,
  detail: (wsId: string, id: string) =>
    [...teamKeys.all(wsId), "detail", id] as const,
  messages: (wsId: string, id: string) =>
    [...teamKeys.all(wsId), "messages", id] as const,
  delegationCards: (wsId: string, messageId: string) =>
    [...teamKeys.all(wsId), "delegation-cards", messageId] as const,
  delegationCardsAll: (wsId: string) =>
    [...teamKeys.all(wsId), "delegation-cards"] as const,
};

export function teamListOptions(wsId: string, status: "active" | "archived" = "active") {
  return queryOptions({
    queryKey: teamKeys.list(wsId, status),
    queryFn: () => api.listTeams(status),
    select: (data) => data.teams,
  });
}

export function teamDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: teamKeys.detail(wsId, id),
    queryFn: () => api.getTeam(id),
  });
}

export function teamMessagesOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: teamKeys.messages(wsId, id),
    queryFn: () => api.listTeamMessages(id),
  });
}

export function delegationTaskCardsOptions(wsId: string, messageId: string) {
  const emptyPollKey = `${wsId}:${messageId}`;

  return queryOptions({
    queryKey: teamKeys.delegationCards(wsId, messageId),
    queryFn: () => api.listDelegationTaskCards(messageId),
    select: (data) => data.cards,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const cards = query.state.data?.cards;
      if (!cards) return 4000;
      if (cards.length === 0) {
        const startedAt = emptyDelegationCardPollStartedAt.get(emptyPollKey) ?? Date.now();
        emptyDelegationCardPollStartedAt.set(emptyPollKey, startedAt);
        return Date.now() - startedAt < EMPTY_DELEGATION_CARD_POLL_MS ? 4000 : false;
      }
      emptyDelegationCardPollStartedAt.delete(emptyPollKey);
      const allDone = cards.every((card) =>
        card.status === "done" ||
        card.status === "in_review" ||
        card.status === "cancelled"
      );
      return allDone ? false : 4000;
    },
  });
}
