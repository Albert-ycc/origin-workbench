# Card-first Delegation Design

Date: 2026-05-06
Status: Draft for user review
Scope: Origin project workspace team chat task delegation

## Summary

Team chat delegation should stop treating every member result as a full main-chat reply. The main timeline should show the user's request, the captain's delegation, a compact task board, and later the captain's synthesis. Individual agent outputs should live inside the corresponding task card.

The recommended approach is to keep the existing issue-backed delegation model and reshape the presentation layer around it. New delegated work continues to create issues linked to the captain message by `source_team_message_id`; the task board renders those issues below the captain message; detailed member replies, comments, and follow-up questions are read and written through the issue comment timeline.

Existing historical chat messages stay unchanged. This design only affects newly produced delegated tasks after implementation.

## Problem

The current UI already creates task cards under a captain reply, but completed member results are also mirrored back into the main team chat as long assistant messages. For a common review flow with 6-8 specialist agents, the main chat becomes a long sequence of independent reports. This makes it hard to scan the actual conversation:

- The captain's intent is separated from the member results.
- The user has to scroll through long reports before seeing the overall conclusion.
- The task cards lose value because the detailed output still appears elsewhere.
- Follow-up comments and issue comments are conceptually separate from the chat surface.

Relevant current anchors:

- Frontend task card rendering: `packages/views/teams/team-detail-page.tsx`
- Issue lookup by captain message: `server/internal/handler/issue.go`
- Delegated issue creation: `server/internal/service/task.go`
- Existing issue comment timeline: `packages/views/issues/hooks/use-issue-timeline.ts`

## Goals

1. Keep the main chat short and scan-friendly for task-heavy conversations.
2. Make the task board the canonical surface for delegated member work.
3. Reuse existing issue and comment infrastructure instead of introducing a parallel task model.
4. Preserve historical chat data exactly as-is.
5. Make real-time updates visible on cards without requiring a full page refresh.
6. Keep the first implementation small enough to review and test safely.

## Non-goals

- Do not migrate, delete, hide, or rewrite existing long mirrored chat messages.
- Do not replace the existing issue system.
- Do not build a full kanban product inside chat in the first implementation.
- Do not change the agent execution contract beyond where final results are displayed.
- Do not introduce analytics, external services, or new network integrations.

## User Experience

### Main Chat Layout

For a delegated task flow, the main chat should read as:

```text
User request
Captain response with concise plan
Delegation board attached to the captain response
Optional user follow-up or captain synthesis
```

Member agents should not create full-length main-chat bubbles for their task completion. Their results update the board row and are available in the task detail view.

### Delegation Board

The board appears directly below the captain message that created the tasks. It should be compact and optimized for scanning.

Board header:

- `派出的任务 · 7 张`
- Summary chips such as `5 已回报`, `2 处理中`, `1 卡点`
- Optional filter tabs: `全部`, `处理中`, `已回报`, `卡点`

Each row displays:

- Assignee avatar and role/name
- Task title
- Status chip
- One-line latest result or progress preview
- Last update time
- Comment/result count when useful

Rows should use a list/table feel, not large nested cards. The board is attached to a chat message, but visually it should feel like a small work surface rather than another chat bubble.

### Task Detail

Clicking a task row opens an inline expansion or right-side drawer. The drawer is preferred for desktop because it keeps the main chat position stable.

Task detail includes:

- Original task instruction from the delegated issue description
- Assignee and status
- Latest/final agent result
- Comment timeline using existing issue comments
- Follow-up input for the user/captain
- Actions: mark done, reopen, copy summary, jump to full issue

The detail view is where long markdown outputs belong.

### Historical Messages

Old mirrored messages such as `✅ @技术架构师 待评审 [...]` remain visible exactly as they are today. They were test data and should not be migrated in this pass.

## Data Model

The existing issue model remains the source of truth.

Current useful fields:

- `issue.source_team_message_id`: captain message that spawned this task
- `issue.source_team_session_id`: team chat session to which this task belongs
- `issue.assignee_type` / `issue.assignee_id`: assigned agent
- `issue.status`: task state
- `issue.description`: original delegated instruction
- issue comments: member result and discussion timeline

One backend correction should be included: when creating a delegated issue from a project team chat session, propagate `session.project_id` into `issue.project_id`. This keeps project-scoped task cards and future project views consistent.

## API Design

### Card List

Use either an expanded version of the existing endpoint or a new endpoint. The safer long-term shape is a dedicated card endpoint:

```http
GET /api/team-messages/{messageId}/task-cards
```

Response:

```ts
type DelegationTaskCard = {
  issue_id: string;
  issue_key: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled" | "backlog";
  assignee: {
    id: string;
    name: string;
    avatar_url?: string | null;
  } | null;
  source_team_message_id: string;
  source_team_session_id: string;
  project_id?: string | null;
  latest_result_preview?: string | null;
  latest_result_comment_id?: string | null;
  comment_count: number;
  updated_at: string;
};
```

The first implementation may extend `GET /api/issues/by-team-message/{messageId}` if that keeps the diff smaller. The frontend should consume a card-shaped adapter either way, so the UI is not coupled to raw `IssueResponse`.

### Card Detail

Reuse existing issue APIs:

- `GET /api/issues/{id}`
- `GET /api/issues/{id}/comments`
- `POST /api/issues/{id}/comments`
- existing issue status update APIs

No duplicate comment API is needed.

## Backend Behavior

### Delegation Creation

Keep the current flow:

1. Captain assistant message is created.
2. `delegateTeamMentions` parses mentions.
3. Each mention creates an issue via `createTeamMentionIssue`.
4. Existing issue assignment enqueues the member agent task.
5. A short system message can still confirm that tasks were delegated.

Change:

- `createTeamMentionIssue` should copy `session.ProjectID` when valid.

### Completion Handling

Current behavior mirrors the member's final issue comment into a new assistant chat message. New behavior:

1. Member agent writes final output to the assigned issue comment timeline.
2. Issue status changes to `in_review` or `done`.
3. Backend publishes an event that lets the board row refresh.
4. Backend does not create a long assistant chat message for the completion.

This preserves the completion signal without inflating the main chat.

### Eventing

The frontend task board should refresh when any of these happen:

- delegated issue created
- issue status changed
- issue comment created/updated/deleted
- task completion event emitted

Minimum event payload fields:

```json
{
  "team_id": "uuid",
  "chat_session_id": "uuid",
  "project_id": "uuid-or-null",
  "source_team_message_id": "uuid",
  "issue_id": "uuid",
  "event": "team_task_updated"
}
```

If a specific event is not available in the first pass, polling can remain as fallback. The board already polls while tasks are not terminal; real-time invalidation should reduce perceived latency and avoid stale finished rows.

## Frontend Architecture

The current task card logic lives inside `team-detail-page.tsx`. The implementation should extract it into focused components:

```text
packages/views/teams/components/delegation-board.tsx
packages/views/teams/components/delegation-task-row.tsx
packages/views/teams/components/delegation-task-detail-drawer.tsx
packages/views/teams/components/delegation-task-comments.tsx
```

Responsibilities:

- `DelegationBoard`: fetches task cards by captain message id, owns filters and summary.
- `DelegationTaskRow`: displays one compact row and status preview.
- `DelegationTaskDetailDrawer`: loads issue detail and timeline for one task.
- `DelegationTaskComments`: wraps existing issue comment/timeline behavior where possible.

`Message` in `team-detail-page.tsx` should only decide whether a captain message can show a delegation board. It should not own board internals.

## Status Semantics

Use the existing issue status values, but map them to task-friendly labels:

| Issue status | UI label | Meaning |
| --- | --- | --- |
| `todo` | 等待中 | Task created, not yet actively running |
| `in_progress` | 处理中 | Agent is working |
| `in_review` | 已回报 | Agent has produced a result for review |
| `done` | 已确认 | Result accepted or closed |
| `blocked` | 卡点 | Agent needs help or cannot proceed |
| `cancelled` | 已取消 | Task no longer needed |
| `backlog` | 待办 | Deferred task |

The board can treat `in_review` as a completed report for progress summaries, while still allowing the captain or user to mark it `done` later.

## Rollout Plan

### Phase 1: Stop main-chat inflation

- Stop creating full mirrored assistant messages for newly completed delegated tasks.
- Keep historical mirrored messages untouched.
- Update board rows to show latest result previews.
- Ensure project id is propagated onto delegated issues.

### Phase 2: Task detail drawer

- Add task detail drawer.
- Reuse issue comment timeline for long outputs and follow-ups.
- Add status actions needed for review closure.

### Phase 3: Realtime polish

- Invalidate board card queries on issue/comment events.
- Keep polling as fallback for running tasks.
- Show unread or changed state for updated cards.

### Phase 4: Captain synthesis support

- Add a board-level action to help the captain synthesize completed reports into a final main-chat response.
- Keep this as a later enhancement so the core display model lands first.

## Testing Strategy

Backend tests:

- Delegated issue creation copies `project_id` from a project chat session.
- Completion handling no longer creates a new assistant chat message for delegated issue completion.
- Completion handling emits an event with `source_team_message_id` and `issue_id`.
- Card list endpoint returns issue status, assignee, latest result preview, and counts with workspace scoping.

Frontend tests:

- Captain message renders a delegation board when linked issues exist.
- Board rows update status labels correctly.
- Long member result is visible in the task detail drawer, not as a new main-chat bubble.
- Existing historical chat messages still render normally.
- Empty/loading/error states do not shift the chat layout awkwardly.

Manual acceptance:

1. Create a project team chat request that delegates to multiple agents.
2. Confirm only the captain response and board appear in the main timeline.
3. Let at least one member finish.
4. Confirm the row becomes `已回报` and shows a concise preview.
5. Open the row and confirm the full markdown result appears in task detail.
6. Confirm old historical mirrored messages remain visible in old conversations.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Users miss completed results because they no longer appear as chat bubbles | Show clear status chips, preview text, and board summary counts |
| Existing issue comment timeline is too issue-page-specific | Wrap it behind `DelegationTaskComments` and reuse hooks first; only extract shared pieces when needed |
| Realtime events are incomplete | Keep polling as fallback and add targeted invalidation incrementally |
| Raw issue API shape leaks into UI | Add a frontend adapter or dedicated card endpoint |
| Historical data looks inconsistent with new behavior | Accept this as a test-data boundary; do not mutate history |

## Open Decision

The design assumes the first implementation uses a right-side drawer for task detail on desktop. Mobile can fall back to a full-height sheet or inline expansion using the same data flow. This is a UI implementation choice and does not change the backend contract.

## Acceptance Criteria

The design is complete when a new delegated team task flow produces this behavior:

- Main chat remains compact after multiple member agents complete their tasks.
- Every delegated member result is reachable from its task card.
- New delegated completions do not create long assistant messages in the main chat.
- Existing historical mirrored messages are unchanged.
- Project-scoped delegated issues remain attached to the project.
- Fast backend and frontend checks pass for the changed surfaces.
