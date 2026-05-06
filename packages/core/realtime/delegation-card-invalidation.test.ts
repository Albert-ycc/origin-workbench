import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { issueKeys } from "../issues/queries";
import { teamKeys } from "../teams/queries";
import type {
  DelegationTaskCard,
  Issue,
  TeamMessageCreatedPayload,
} from "../types";
import {
  invalidateDelegationCardsForIssue,
  invalidateDelegationCardsForIssueId,
  syncDelegationCardsForTeamMessageCreated,
} from "./delegation-card-invalidation";

const wsId = "ws-1";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function spyOnInvalidations(qc: QueryClient) {
  const spy = vi.spyOn(qc, "invalidateQueries");
  return () => spy.mock.calls.map(([filters]) => filters?.queryKey);
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    workspace_id: wsId,
    number: 1,
    identifier: "FAI-1",
    title: "Delegated task",
    description: null,
    status: "in_progress",
    priority: "medium",
    assignee_type: "agent",
    assignee_id: "agent-1",
    creator_type: "member",
    creator_id: "user-1",
    parent_issue_id: null,
    project_id: null,
    position: 0,
    due_date: null,
    created_at: "2026-05-06T00:00:00Z",
    updated_at: "2026-05-06T00:00:00Z",
    ...overrides,
  };
}

function makeCard(overrides: Partial<DelegationTaskCard> = {}): DelegationTaskCard {
  return {
    issue_id: "issue-1",
    issue_key: "FAI-1",
    workspace_id: wsId,
    number: 1,
    title: "Delegated task",
    status: "in_progress",
    assignee_id: "agent-1",
    assignee_name: "Codex Local",
    assignee_avatar_url: null,
    source_team_message_id: "message-1",
    source_team_session_id: "team-session-1",
    project_id: null,
    latest_result_preview: null,
    latest_result_comment_id: null,
    comment_count: 0,
    updated_at: "2026-05-06T00:00:00Z",
    ...overrides,
  };
}

describe("delegation card realtime invalidation", () => {
  it("invalidates only the source delegation cards for lightweight team completion events", () => {
    const qc = createQueryClient();
    const invalidatedKeys = spyOnInvalidations(qc);
    const payload: TeamMessageCreatedPayload = {
      team_id: "team-1",
      event: "team_task_completed",
      chat_session_id: "chat-session-1",
      issue_id: "issue-1",
      source_team_message_id: "message-1",
      source_team_session_id: "team-session-1",
    };

    const result = syncDelegationCardsForTeamMessageCreated(qc, wsId, payload);

    expect(result.skipTeamMessageRefresh).toBe(true);
    expect(invalidatedKeys()).toContainEqual(
      teamKeys.delegationCards(wsId, "message-1"),
    );
    expect(invalidatedKeys()).not.toContainEqual(
      teamKeys.messages(wsId, "team-1"),
    );
  });

  it("invalidates source delegation cards when an updated issue carries the source message id", () => {
    const qc = createQueryClient();
    const invalidatedKeys = spyOnInvalidations(qc);

    invalidateDelegationCardsForIssue(
      qc,
      wsId,
      makeIssue({ source_team_message_id: "message-1" }),
    );

    expect(invalidatedKeys()).toContainEqual(
      teamKeys.delegationCards(wsId, "message-1"),
    );
  });

  it("resolves an issue-only event from loaded delegation card cache", () => {
    const qc = createQueryClient();
    const invalidatedKeys = spyOnInvalidations(qc);
    qc.setQueryData(teamKeys.delegationCards(wsId, "message-1"), {
      cards: [makeCard({ issue_id: "issue-1" })],
      total: 1,
    });

    invalidateDelegationCardsForIssueId(qc, wsId, "issue-1");

    expect(invalidatedKeys()).toContainEqual(
      teamKeys.delegationCards(wsId, "message-1"),
    );
  });

  it("resolves an issue-only event from loaded issue detail cache", () => {
    const qc = createQueryClient();
    const invalidatedKeys = spyOnInvalidations(qc);
    qc.setQueryData(
      issueKeys.detail(wsId, "issue-1"),
      makeIssue({ source_team_message_id: "message-1" }),
    );

    invalidateDelegationCardsForIssueId(qc, wsId, "issue-1");

    expect(invalidatedKeys()).toContainEqual(
      teamKeys.delegationCards(wsId, "message-1"),
    );
  });

  it("does not fall back to broad team invalidation when issue source cannot be resolved", () => {
    const qc = createQueryClient();
    const invalidatedKeys = spyOnInvalidations(qc);

    invalidateDelegationCardsForIssueId(qc, wsId, "unknown-issue");

    expect(invalidatedKeys()).toEqual([]);
  });
});
