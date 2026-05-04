import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { MailboxItemFilter } from "../types/mailbox";

export const mailboxKeys = {
  all: (wsId: string) => ["mailbox", wsId] as const,
  list: (wsId: string, filter: MailboxItemFilter = {}) =>
    [...mailboxKeys.all(wsId), "list", filter] as const,
  detail: (wsId: string, id: string) =>
    [...mailboxKeys.all(wsId), "detail", id] as const,
};

// Workbench block 6: top N most-recently-finished mailbox reports.
export function mailboxListOptions(
  wsId: string,
  filter: MailboxItemFilter = {},
) {
  return queryOptions({
    queryKey: mailboxKeys.list(wsId, filter),
    queryFn: () => api.listMailboxItems(filter),
    select: (data) => data.items,
  });
}

export function mailboxDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: mailboxKeys.detail(wsId, id),
    queryFn: () => api.getMailboxItem(id),
    enabled: !!id,
  });
}
