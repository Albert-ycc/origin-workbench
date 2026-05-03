# Origin Workbench

> A single-user local AI Agent workbench, forked from
> [multica-ai/multica](https://github.com/multica-ai/multica).
>
> **Powered by Multica** · Apache 2.0 (with the upstream's additional conditions —
> see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE)).
> The original Multica README is preserved at [`README.upstream.md`](README.upstream.md).

---

## What is Origin?

Origin reframes Multica from "multi-tenant SaaS for human + agent teams" into a
**personal local Agent workbench**. One operator, one machine, one workspace,
many agents. The desktop app is the only first-class shell.

If Multica is "Linear with AI agents as teammates", Origin is "the personal
notebook + multi-agent control plane I want on my own laptop":

- I describe what I want in natural language → a captain agent decomposes it.
- I drop a half-formed idea into the **Idea Pool** → it sits there until I'm
  ready, then upgrades to a Mission with one click.
- When a decision needs multiple perspectives, I open a **Council Session** —
  a temporary room with the right agents, with explicit "quiet / concise /
  lively" turn-taking rules.
- My identity card and communication preferences live in
  **User Profile**, ready to be injected as the closest layer of every agent's
  system prompt (Phase 7 wires this end-to-end with API runtimes).

It runs entirely against `localhost`. There is no Origin Cloud, no team
invitation, no email verification — sign in with a name and an avatar and you're
in.

## Differences from upstream Multica

| Area | Upstream Multica | Origin fork |
|---|---|---|
| Deployment model | Multi-tenant SaaS / self-hosted | Single-user, single workspace, local-only |
| Login | Email + verification code (or Google OAuth) | Name + avatar (`/auth/local-signin`) |
| Workspace | User-creatable, switchable | Hardcoded `Fairy`, no UI to rename |
| Web frontend | `apps/web/` (Next.js) | **Removed.** Desktop is the only shell. |
| Members / invitations / labs / repos | Settings tabs | **Removed** — they conflict with the single-user model. |
| Auto-updater | Pulls from official Multica releases | **Removed** — would overwrite the fork. |
| Idea Pool / Council Session / User Profile | — | New product objects (Phase 1, migrations 074–076). |
| Avatars | Generated via DiceBear remote URLs | Bundled 30-Lorelei offline pool. |

A complete list of substantive modifications lives in [`NOTICE`](NOTICE).

## Status

This is an active personal fork — interfaces will change without notice. If
you want a stable, supported product, use upstream Multica.

The product roadmap and PM-flavoured design notes are kept private to the
fork (in `docs-private/`, gitignored). The architectural decisions worth
sharing are documented in [`NOTICE`](NOTICE).

## Quick start

The desktop app is the only supported shell.

```bash
# 1. Install deps
pnpm install

# 2. Start the backend (Postgres + Go server) via Docker Compose
docker compose -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml up -d --build backend

# 3. Run the desktop app in dev mode (electron-vite HMR)
pnpm dev:desktop
```

The app opens at the local sign-in screen — pick an avatar, type a name, and
you're in. Local sign-in does not require email or verification code.

## Build a release desktop app

```bash
pnpm --filter @multica/desktop build
cd apps/desktop
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder \
  --mac --arm64 --dir -c.mac.notarize=false -c.mac.identity=null
```

The packaged `.app` lands in `apps/desktop/dist-local/mac-arm64/`.

## License & attribution

This fork is distributed under the **same modified Apache License 2.0** as
upstream Multica. See [`LICENSE`](LICENSE) for the full text including the
upstream's additional conditions §1a (no SaaS / commercial embedding without
written permission) and §1b (preserve LOGO / copyright in `apps/web/`).
The Origin fork resolves §1b by removing `apps/web/` rather than modifying it.

For the formal modification list and upstream attribution, see [`NOTICE`](NOTICE).

The "Multica" name, wordmark, logo assets, and the multica.ai service belong
to Multica, Inc. and are not part of this fork.

## Upstream

- Source: https://github.com/multica-ai/multica
- License: https://github.com/multica-ai/multica/blob/main/LICENSE
