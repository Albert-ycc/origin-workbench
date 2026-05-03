# Repository Guidelines

This file is a concise pointer for AI agents working in this repository.
The detailed engineering rules live in [`CLAUDE.md`](CLAUDE.md); read it before
editing.

## Product Context

Origin is a single-user local AI Agent workbench forked from Multica.
Desktop is the supported product shell. The old upstream Web frontend,
workspace invitation flow, cloud onboarding, and multi-user SaaS concepts are
not part of the Origin user path.

## Architecture

- `server/` — Go backend (Chi router, sqlc, gorilla/websocket).
- `apps/desktop/` — Electron desktop app and primary UI shell.
- `packages/core/` — Headless business logic, API client, stores, query hooks.
- `packages/ui/` — Atomic UI components and design tokens.
- `packages/views/` — Shared business pages/components used by Desktop.
- `packages/tsconfig/` — Shared TypeScript config.

## Hard Boundaries

- `packages/core/`: no `react-dom`, no localStorage, no `process.env`, no UI libraries.
- `packages/ui/`: no `@multica/core` imports.
- `packages/views/`: no `next/*`, no `react-router-dom`; route through the navigation adapter.
- `apps/desktop/src/renderer/src/platform/`: desktop router wiring belongs here.

## Common Commands

```bash
make selfhost                         # Build/start local PostgreSQL + backend
pnpm dev:desktop                      # Run the desktop shell
pnpm --filter @multica/desktop typecheck
pnpm --filter @multica/views typecheck
pnpm --filter @multica/core typecheck
cd server && go test ./...
```

## Safety

- Keep diffs small and scoped.
- Do not reintroduce `apps/web`, cloud login, member invitations, or upstream
  release/update URLs unless the user explicitly asks for a compatibility task.
- Do not touch secrets or print `.env` values.
