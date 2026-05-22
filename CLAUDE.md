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

## Naming split — `Origin` vs `multica`

Origin's branding split is structural, not transitional. **Don't try to
"unify" the names** — you'll break daemon/runtime compatibility.

- **`Origin` is the user-facing identity** — desktop app productName +
  bundle id (`ai.origin.desktop`) + userData path
  (`~/Library/Application Support/Origin`) + DMG / zip artifact names
  (`origin-${version}-mac-${arch}.${ext}`) + dock icon + the README hero
  + the in-app Origin icon.
- **`multica` stays for compatibility** — CLI binary name (`multica`),
  Go module path (`github.com/multica-ai/multica/server`), npm package
  namespace (`@multica/*`), daemon/runtime protocol fields (`provider`,
  `client_platform`, etc.), Docker image tag (`origin-backend:dev` is
  the new bake tag, but `docker compose -p multica` is required for
  the existing volume mount).

Known cosmetic mismatches (don't touch unless explicitly refactoring):

- `packages/ui/components/common/multica-icon.tsx` exports `MulticaIcon`
  but renders the Origin app icon inline. The export name has 5+
  import sites; the visual identity is the substance.
- `apps/desktop/build/icon.png` is the source raster for the desktop icon set.
  Keep `apps/desktop/build/icon.icns`, `apps/desktop/build/icon.ico`,
  `apps/desktop/resources/icon.png`, `apps/desktop/src/renderer/public/icon.png`,
  and `packages/ui/components/common/origin-icon-data.ts` in sync when it changes.

## Versioning

Tags must be **strict semver `X.Y.Z`** — `electron-updater` validates
the app version on main process startup, and a non-semver tag (e.g.
`v1.01`, `v1.0a`) crashes the app with `App version is not a valid
semver version`. Bump as `v1.0.2`, not `v1.02`.

`apps/desktop/package.json` must keep `"productName": "Origin"`.
Without it, chromium subprocess fork uses the npm `name`
(`@multica/desktop`) for default userData, scattering data into
`~/Library/Application Support/@multica` instead of `Origin`.

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
docker compose -p multica -f docker-compose.selfhost.yml -f docker-compose.selfhost.build.yml up -d --no-deps --force-recreate backend
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

## Runtime Last Mile

`localhost:8080` is served by the Docker backend container
`multica-backend-1`. The desktop daemon health server runs separately on a
profile-derived port such as `127.0.0.1:19544`; do not use that daemon port to
verify business APIs.

For backend route, handler, SQL, or generated sqlc changes, "done" requires:

1. Fastest relevant unit tests for the touched code.
2. Rebuild/recreate the existing Docker backend on Compose project `multica`.
3. Authenticated HTTP smoke against `http://localhost:8080` for the changed
   route.

Use `-p multica` when recreating the existing backend. Without it, Compose may
use the file-level project name `origin` and try to create `origin-postgres-1`,
which collides with the existing `multica-postgres-1` port 5432.

The installed desktop app directory should keep exactly two versions: current
`/Users/albert/Applications/Origin.app` and one rollback directory named
`Origin.app.rollback-*`. Do not accumulate historical `.app` bundles in
`/Users/albert/Applications`.

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

### Desktop Build (sandbox + preload)

`apps/desktop/src/main/index.ts` runs `BrowserWindow` with
`sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`
(hardened in commit `669700a2`, 2026-05-19).

Under sandbox, the preload script's `require` resolution is restricted —
it **cannot require external `node_modules`**. The chromium sandbox
bundle reports `module not found` if any preload import is left as an
external dependency.

`apps/desktop/electron.vite.config.ts` must therefore **exclude every
package the preload script actually imports** from
`externalizeDepsPlugin`. Current shape:

```typescript
preload: {
  plugins: [externalizeDepsPlugin({ exclude: ["@electron-toolkit/preload"] })],
},
```

If you add a new `import` to `src/preload/index.ts`, append the package
to the exclude list. Otherwise the renderer never gets
`window.desktopAPI` and the whole window stays blank on launch.

### Desktop Build Pipeline

Build via the package script, **not** the raw electron-builder binary:

```bash
pnpm --filter @multica/desktop run package -- --mac --arm64 --dir \
  -c.mac.notarize=false -c.mac.identity=null
```

`scripts/package.mjs` cleans `dist-local`, runs `electron-vite build`,
bundles the matching Go CLI, and injects the `git describe` version.
Calling `pnpm exec electron-builder` directly skips all of this and
pollutes `app.asar` root with stray files from `apps/desktop/`.

Verify every build before installing into `~/Applications/Origin.app`:

```bash
# preload must be bundled (size ≥ 6KB, external require count = 0)
ls -la apps/desktop/out/preload/index.js
grep -c '@electron-toolkit/preload' apps/desktop/out/preload/index.js

# asar root must not contain orphan vite chunks or .turbo logs
npx -y --package=asar -- asar list \
  apps/desktop/dist-local/mac-arm64/Origin.app/Contents/Resources/app.asar \
  | grep "^/[^/]" | head

# command-line launch must show 4-5 processes and no preload errors
~/Applications/Origin.app/Contents/MacOS/Origin > /tmp/origin.log 2>&1 &
sleep 6
grep -iE "preload|module not found|Cannot read prop" /tmp/origin.log
ps -ef | grep "Origin.app/Contents" | grep -v grep
```

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
