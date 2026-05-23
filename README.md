<div align="center">

<img src="apps/desktop/build/icon.png" alt="Origin Workbench" width="120" />

# Origin Workbench

### A single-user local AI Agent workbench

**One operator, one machine, one workspace, many agents.**
The personal notebook + multi-agent control plane I want on my own laptop.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Powered by Multica](https://img.shields.io/badge/Powered%20by-Multica-7c3aed.svg)](https://github.com/multica-ai/multica)
[![Desktop · macOS](https://img.shields.io/badge/Desktop-macOS%20arm64-000.svg)](#build-a-release-desktop-app)
[![Mobile · Preview](https://img.shields.io/badge/Mobile-LAN%20PWA%20preview-0f766e.svg)](#origin-mobile-preview)
[![Status · Active fork](https://img.shields.io/badge/Status-Active%20fork-orange.svg)](#status)

[Upstream](https://github.com/multica-ai/multica) · [License](LICENSE) · [Notice](NOTICE) · [Contributing](CONTRIBUTING.md) · [Changelog](https://github.com/Albert-ycc/origin-workbench/releases)

**English** | [简体中文](README.zh-CN.md)

</div>

---

> Forked from [multica-ai/multica](https://github.com/multica-ai/multica). **Powered by Multica** · Apache 2.0 (with the upstream's additional conditions — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE)). The original Multica README is preserved at [`README.upstream.md`](README.upstream.md).

---

## What is Origin?

Origin reframes Multica from "multi-tenant SaaS for human + agent teams" into a
**personal local Agent workbench**. One operator, one machine, one workspace,
many agents. The desktop app remains the primary supported shell, and v1.1 adds
a mobile preview for quick capture and lightweight review on the same LAN.

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

## Model API runtime

Origin can connect to an external OpenAI-compatible model API, relay gateway,
or cc-switch / Codex OpenAI-compatible environment for chat-style agent replies.
The API runtime now includes an Origin-owned tool-call loop and read-only local
file tools (`list_directory`, `read_text_file`, `search_text`) so API-backed
agents can inspect allowed project context. It still does not inherit Codex or
Claude Code abilities such as file writes, shell execution, browser control,
MCP tools, or skill execution.

See [`docs/model-api-runtime.md`](docs/model-api-runtime.md) for capabilities,
environment variables, and the full-agent roadmap.

## Differences from upstream Multica

| Area | Upstream Multica | Origin fork |
|---|---|---|
| Deployment model | Multi-tenant SaaS / self-hosted | Single-user, single workspace, local-only |
| Login | Email + verification code (or Google OAuth) | Name + avatar (`/auth/local-signin`) |
| Workspace | User-creatable, switchable | Hardcoded `Fairy`, no UI to rename |
| Web frontend | `apps/web/` (Next.js) | **Removed.** Desktop is the primary shell; `apps/mobile/` is a local companion preview. |
| Members / invitations / labs / repos | Settings tabs | **Removed** — they conflict with the single-user model. |
| Auto-updater | Pulls from official Multica releases | **Removed** — would overwrite the fork. |
| Idea Pool / Council Session / User Profile | — | Origin-native local workflow objects. |
| Inbox / team collaboration mailbox | Team-oriented collaboration surface | Removed from the product path; attachments and captured ideas stay local-user focused. |
| Avatars | Generated via DiceBear remote URLs | Bundled 50-Origin offline avatar pool. |

A complete list of substantive modifications lives in [`NOTICE`](NOTICE).

## Status

This is an active personal fork — interfaces will change without notice. If
you want a stable, supported product, use upstream Multica.

The product roadmap and PM-flavoured design notes are kept private to the
fork (in `docs-private/`, gitignored). The architectural decisions worth
sharing are documented in [`NOTICE`](NOTICE).

## Quick start

The desktop app is the primary supported shell.

```bash
# 1. Install deps
pnpm install

# 2. Start the backend (Postgres + Go server) via Docker Compose
docker compose -p multica -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml up -d --build backend

# 3. Run the desktop app in dev mode (electron-vite HMR)
pnpm dev:desktop
```

The app opens at the local sign-in screen — pick an avatar, type a name, and
you're in. Local sign-in does not require email or verification code.

## Origin Mobile preview

`apps/mobile/` is a v1.1 preview shell for phone-side Origin access. It can run
as a LAN PWA today and is prepared for Capacitor-based iPhone installation. The
current scope is intentionally small: connect to the Mac backend, load the local
workspace, review missions and agents, capture ideas, and upload short voice
notes as local Origin attachments. It is not an Origin Cloud client and does not
bring back teams, invitations, or multi-user SaaS flows.

```bash
pnpm --filter @multica/mobile dev
pnpm --filter @multica/mobile build
```

See [`apps/mobile/README.md`](apps/mobile/README.md) for the phone setup flow.

## Build a release desktop app

```bash
pnpm --filter @multica/desktop run package -- --mac --arm64 --dir \
  -c.mac.notarize=false -c.mac.identity=null
```

The packaged `.app` lands in `apps/desktop/dist-local/mac-arm64/`.

For a local installed update, rebuild/recreate the existing backend container
on Compose project `multica`, replace `/Users/albert/Applications/Origin.app`,
and keep only one `Origin.app.rollback-*` copy for rollback.

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
