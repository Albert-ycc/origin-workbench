# CLAUDE.md

This file guides AI agents working on the Origin repository.

## Project Context

Origin is a local-first fork of Multica. The product direction is a
single-user, desktop-first multi-agent workbench:

- Mission / Idea / Council Session / Branching Exploration / Tool Binding /
  Agent / UserProfile workflows are the primary product surface.
- The default user path is local nickname + avatar sign-in.
- Desktop is the supported shell.
- The upstream Web frontend, workspace invitation UI, cloud onboarding,
  Google OAuth login UI, and multi-user SaaS concepts are legacy or removed
  paths and must not be reintroduced as normal product flow.

The CLI binary and Go module still use the `multica` name for compatibility
with the existing daemon/runtime architecture. Do not rename the module or CLI
as part of ordinary cleanup work.

## Architecture

- `server/` — Go backend, Chi router, sqlc-generated database layer,
  gorilla/websocket realtime transport.
- `apps/desktop/` — Electron desktop app, the only first-class product shell.
- `packages/core/` — Headless business logic, API client, query hooks, stores,
  platform adapters.
- `packages/ui/` — Atomic UI components and design tokens.
- `packages/views/` — Desktop-consumed business pages/components.
- `packages/tsconfig/` — Shared TypeScript config.

## Commands

```bash
# Local runtime
make selfhost                         # Build/start PostgreSQL + backend
make selfhost-stop                    # Stop local Docker Compose services
pnpm dev:desktop                      # Run Electron desktop dev app

# TypeScript checks
pnpm --filter @multica/core typecheck
pnpm --filter @multica/views typecheck
pnpm --filter @multica/desktop typecheck

# Tests
pnpm --filter @multica/core test
pnpm --filter @multica/views test
pnpm --filter @multica/desktop test
cd server && go test ./...

# Backend/dev utilities
make db-up
make db-reset
make sqlc
cd server && go run ./cmd/migrate up
cd server && go run ./cmd/server
```

## Coding Rules

- Prefer existing patterns over new abstractions.
- Keep changes scoped and reviewable.
- TypeScript strict mode is enabled; keep types explicit.
- Go code must remain `gofmt` clean.
- Keep code comments in English unless editing user-facing Chinese copy.
- Do not add compatibility layers, fallback paths, dual writes, or temporary
  shims unless the user explicitly asks for backwards compatibility.
- If a removed upstream flow conflicts with Origin's local product model,
  keep it hidden or delete it instead of surfacing it again.

## State Management

- TanStack Query owns server state.
- Zustand owns client state.
- Do not duplicate API data into Zustand.
- Workspace-scoped queries must key on `wsId`.
- WebSocket events invalidate queries; they should not mutate stores directly.
- Persist only durable UI preferences and drafts, not transient modal state or
  server data.

## Package Boundaries

- `packages/core/`: no `react-dom`, no localStorage, no `process.env`, no UI
  libraries. Shared Zustand stores live here.
- `packages/ui/`: no `@multica/core` imports.
- `packages/views/`: no `next/*`, no `react-router-dom`, no app-specific
  imports. Use `NavigationAdapter` for navigation.
- `apps/desktop/src/renderer/src/platform/`: desktop-specific router wiring.

## Desktop Rules

Desktop routes fall into these categories:

- Session routes: workspace-scoped pages rendered under `WorkspaceRouteLayout`.
- Transition/legacy overlays: one-shot flows kept only when needed for
  compatibility; do not add new product paths here without a product reason.
- Stale state recovery: heal silently by dropping invalid tab/workspace state.

Every full-window desktop view outside the dashboard shell must mount
`<DragStrip />` from `@multica/views/platform` as the first flex child.

## UI Rules

- Use shadcn/Base UI components and existing design tokens.
- Avoid hardcoded Tailwind colors.
- Keep text in Chinese for user-facing Origin UI unless the surrounding
  component is still intentionally developer-facing.
- Watch overflow, truncation, and dense desktop layout ergonomics.

## Testing Rules

Tests follow the code:

| What | Location |
|---|---|
| Headless business logic | `packages/core/*.test.ts` |
| Shared UI components | `packages/views/*.test.tsx` |
| Desktop platform wiring | `apps/desktop/**/*.test.ts(x)` |
| Go handlers/services | `server/**/*_test.go` |

Use the fastest relevant check first. For UI-only desktop changes, start with:

```bash
pnpm --filter @multica/desktop typecheck
```

For backend handler/query changes:

```bash
cd server && go test ./internal/handler ./pkg/db/...
```

## Open-Source Cleanup Guardrails

- Keep upstream attribution in `LICENSE`, `NOTICE`, and preserved upstream
  README files.
- Do not point public install/update/help links at `multica.ai`,
  `multica-ai/homebrew-tap`, or `github.com/multica-ai/multica` unless the
  context is explicit upstream attribution.
- Do not restore `apps/web` or `Dockerfile.web`.
- Do not make `multica update` upgrade from the upstream tap or upstream GitHub
  Releases.
