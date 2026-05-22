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

## Git Workflow

Before making code changes, read and follow [`docs/git-workflow.md`](docs/git-workflow.md).

- Use one branch and one `git worktree` per task when running parallel agents or
  parallel feature/bugfix work.
- Merge `feature/*` and `fix/*` branches into `develop` first for test
  verification; reserve `main` for production-ready releases.
- Do not mix unrelated bugs, features, or cleanup in the same branch.
- Before merging, report what changed, what was verified, and what remains
  unverified.

## Common Commands

```bash
make selfhost                         # Build/start local PostgreSQL + backend
docker compose -p multica -f docker-compose.selfhost.yml -f docker-compose.selfhost.build.yml up -d --no-deps --force-recreate backend
pnpm dev:desktop                      # Run the desktop shell
pnpm --filter @multica/desktop typecheck
pnpm --filter @multica/views typecheck
pnpm --filter @multica/core typecheck
cd server && go test ./...
```

## Runtime Verification

- Business API traffic is served by Docker container `multica-backend-1` on
  `localhost:8080`; the desktop daemon health port (`127.0.0.1:19544`) is not
  the API server.
- After backend route/handler/query changes, rebuild or recreate the existing
  backend container with Compose project `multica`, then run a real HTTP smoke
  against `localhost:8080`. Handler tests alone are not enough.
- When replacing the installed desktop app, keep only two local copies:
  `/Users/albert/Applications/Origin.app` and one
  `/Users/albert/Applications/Origin.app.rollback-*`.

## Build/Storage Hygiene

- Never include build artifacts in Desktop packages.
- Clean the target output directory before each Desktop build.
- Keep `apps/desktop/electron-builder.yml` exclusions for `dist-local`,
  `dist`, and `node_modules/.cache` explicit.

## Safety

- Keep diffs small and scoped.
- Do not reintroduce `apps/web`, cloud login, member invitations, or upstream
  release/update URLs unless the user explicitly asks for a compatibility task.
- Do not touch secrets or print `.env` values.
