# Mission Workbench P0 Development Plan

Date: 2026-05-20
Status: Draft task breakdown
Scope: Origin desktop Mission workflow

## Goal

Deliver the P0 Mission Workbench loop:

> fuzzy idea -> Mission brief -> plan -> AI assignments -> event history -> deliverable recap.

This plan assumes Origin remains local-first, single-user, and desktop-first. It should reuse existing Project v12, Idea, Mission, MissionPlanItem, MissionAssignment, MissionEvent, Council/Meeting, ToolBinding, and Skill surfaces before adding new primitives.

## Delivery Definition

P0 is shippable when a user can:

- Create a Mission from a Project.
- Promote an Idea into a Mission.
- Edit the Mission brief.
- Manage plan items across plan, execute, verify, and ship.
- Launch an assignment from a plan item with visible capability boundaries.
- See assignment status, output summary, blockers, and Mission events.
- Close the Mission with a recap containing deliverable, evidence, decisions, open issues, and follow-ups.
- Reopen the Project and reconstruct what happened without reading the entire chat.

## Milestone 0: Baseline Map

Objective: confirm current routes, APIs, stores, and UI surfaces before writing implementation code.

Tasks:

- [ ] Search current Mission, Idea, Project, Council, Meeting, Skill, and ToolBinding UI entry points.
- [ ] Map current API handlers and persistence paths for Mission creation, plan items, assignments, and events.
- [ ] Identify whether closeout notes and artifact links can be stored in existing Mission outcome and MissionEvent payload fields.
- [ ] Identify the current desktop route where Project workspace should expose the primary Mission entry point.
- [ ] Create an implementation note listing exact files to touch for P0.1 to P0.6.

Useful commands:

```bash
rg -n "Mission|MissionPlanItem|MissionAssignment|MissionEvent|Idea|Council|Meeting|ToolBinding|Skill|project_v12" server packages apps
rg -n "createMission|promote.*Mission|mission" server packages apps
```

Acceptance:

- [ ] No P0 implementation starts without an exact file map.
- [ ] Any required schema change is justified against existing Mission and Project fields.

## P0.1: Mission Entry And Brief

Objective: make Mission creation the main way to start work inside a Project.

Tasks:

- [ ] Add or refine the Project-level "Start Mission" entry point.
- [ ] Add a compact Mission creation flow with title, prompt, desired deliverable, constraints, non-goals, execution mode, and risk level.
- [ ] Support Idea-to-Mission promotion from the existing Idea surface.
- [ ] Land the user on the Mission detail after creation or promotion.
- [ ] Persist the brief using existing Mission fields and event payloads where possible.

Acceptance:

- [ ] A fuzzy idea can become a Mission in under three minutes.
- [ ] The created Mission displays title, prompt, desired outcome, status, risk, and execution mode.
- [ ] Idea promotion preserves the original idea context.
- [ ] No cloud, organization, invite, or multi-user copy appears in the flow.

Fast checks:

```bash
pnpm --filter @multica/core typecheck
pnpm --filter @multica/views typecheck
```

## P0.2: Mission Plan Surface

Objective: turn the Mission into a small, editable work plan.

Tasks:

- [ ] Show MissionPlanItem rows grouped by plan, execute, verify, and ship.
- [ ] Support create, edit, reorder or priority adjustment, status change, and cancellation.
- [ ] Show each item title, phase, status, priority, risk level, assigned agent, and latest output summary.
- [ ] Keep plan generation optional; manual plan editing must work without an AI call.
- [ ] Emit MissionEvent records for meaningful plan changes.

Acceptance:

- [ ] Plan items can be managed without leaving Mission detail.
- [ ] Plan statuses match existing MissionPlanStatus values.
- [ ] The user can understand the next action from the plan surface alone.

Fast checks:

```bash
pnpm --filter @multica/core typecheck
pnpm --filter @multica/views typecheck
```

## P0.3: Assignment Launch From Plan Item

Objective: make each AI work attempt explicit, bounded, and attached to the Mission.

Tasks:

- [ ] Add "Launch assignment" from each actionable plan item.
- [ ] Show agent or skill selection using existing capability surfaces.
- [ ] Show included context before launch: Mission brief, plan item, Project context, relevant meeting or chat context when available.
- [ ] Require expected output and confirmation mode before dispatch.
- [ ] Create a MissionAssignment linked to the Mission and plan item.
- [ ] Record assignment launch as a MissionEvent.

Acceptance:

- [ ] Every assignment is traceable to a Mission.
- [ ] Assignments launched from plan items are traceable to those plan items.
- [ ] The launch UI does not promise unavailable local shell, browser, file-writing, or external connector capability.
- [ ] Failed or blocked assignments leave visible status and reason.

Fast checks:

```bash
pnpm --filter @multica/core typecheck
pnpm --filter @multica/views typecheck
```

## P0.4: Mission Timeline And Work State

Objective: let the user review what happened without reading raw chat history.

Tasks:

- [ ] Add a Mission status strip showing status, active assignment, blocked count, latest output, and next suggested action.
- [ ] Add a timeline grouped by high-value event types: created, brief changed, plan changed, assignment launched, output received, blocked, decision, closeout.
- [ ] Collapse noisy runtime details behind a secondary view.
- [ ] Link timeline events back to plan items, assignments, meetings, or artifacts when references exist.
- [ ] Add empty, loading, blocked, failed, and completed states.

Acceptance:

- [ ] A reopened Mission tells the story of the work in less than one minute.
- [ ] Active and blocked work is visible without opening each assignment.
- [ ] Timeline entries are readable product events, not raw logs.

Fast checks:

```bash
pnpm --filter @multica/views typecheck
```

## P0.5: Closeout Recap

Objective: close a Mission with a reusable record.

Tasks:

- [ ] Add a closeout action when all required plan items are done or cancelled.
- [ ] Generate or edit a recap with final deliverable, evidence, decisions, open issues, follow-ups, and memory notes.
- [ ] Save the recap into Mission outcome and record a closeout MissionEvent.
- [ ] If the existing Project memory path supports it, append a concise memory note. If not, provide a copy-ready memory note in the recap.
- [ ] Allow reopening a completed Mission only through an explicit action.

Acceptance:

- [ ] Completed Missions have a durable recap.
- [ ] The recap is understandable without the original chat.
- [ ] The user can distinguish shipped output from unresolved follow-up work.

Fast checks:

```bash
pnpm --filter @multica/core typecheck
pnpm --filter @multica/views typecheck
```

## P0.6: Dogfood Template

Objective: prove the loop on Origin's own product work.

Tasks:

- [ ] Create one built-in example or seedable Mission template for product planning.
- [ ] Use the template to run "Mission Workbench P0" as a real Mission in local desktop.
- [ ] Capture at least one assignment, one blocker or decision, one output, and one closeout recap.
- [ ] Tighten empty states and labels based on dogfood friction.

Acceptance:

- [ ] A new user can understand the Mission loop from the example without reading docs.
- [ ] Dogfood creates a reviewable record that matches the P0 product promise.

Fast checks:

```bash
pnpm --filter @multica/desktop typecheck
```

## P0.7: Release Readiness

Objective: verify the P0 loop works end to end in the desktop app.

Tasks:

- [ ] Run fastest relevant type checks for touched packages.
- [ ] Run backend tests for touched Go handlers or query code.
- [ ] Smoke test the desktop Mission flow manually.
- [ ] Verify no cloud, organization, invite, billing, or multi-user path was added.
- [ ] Update user-facing docs or README only where the Mission flow behavior changed.

Useful checks:

```bash
pnpm --filter @multica/core typecheck
pnpm --filter @multica/views typecheck
pnpm --filter @multica/desktop typecheck
go test ./...
```

Acceptance:

- [ ] The P0 scenario can be demonstrated from a fresh Project.
- [ ] Mission creation, planning, assignment launch, timeline, and closeout all persist across reload.
- [ ] The release notes state the real runtime capability boundaries.

## Dependency Order

1. Milestone 0: Baseline Map
2. P0.1: Mission Entry And Brief
3. P0.2: Mission Plan Surface
4. P0.3: Assignment Launch From Plan Item
5. P0.4: Mission Timeline And Work State
6. P0.5: Closeout Recap
7. P0.6: Dogfood Template
8. P0.7: Release Readiness

## Product Cut Line

Anything outside the core loop should wait:

- Rich marketplace or agent directory
- Complex automation builder
- Cloud sync
- Team permissions
- Enterprise audit controls
- Mobile layout
- Analytics dashboard
- Full connector framework

The first credible version is not the most powerful agent system. It is the first version that reliably helps the user finish one real Mission and remember what happened.
