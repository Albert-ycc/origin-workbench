# Origin Local Hosting Guide

Origin is a local-first fork of Multica. The supported product shell is the
desktop app; Docker Compose only runs PostgreSQL and the backend API used by the
desktop app, CLI, and daemon.

There is no Origin Cloud, public Web frontend, workspace invitation flow, or
email/OAuth login requirement in the primary product path.

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL + backend from this checkout
make selfhost

# 3. Start the desktop shell
pnpm dev:desktop
```

Open the desktop app, choose an avatar, enter a nickname, and sign in locally.

## What Runs

| Component | Purpose | Default |
|---|---|---|
| PostgreSQL | Local database with pgvector | `localhost:5432` |
| Backend | REST API, WebSocket, daemon coordination | `http://localhost:8080` |
| Desktop | Primary Origin product shell | Electron dev app |
| CLI / daemon | Local runtime discovery and task execution | `multica` binary |

The old `apps/web` frontend has been removed from this fork. Any references to
web dashboards, cloud login, or workspace invitations are legacy compatibility
only and are not part of the Origin user flow.

## Manual Compose

```bash
cp .env.example .env
# Change JWT_SECRET before sharing this machine or exposing the backend.

docker compose -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml up -d --build
```

Check health:

```bash
curl http://localhost:8080/health
```

Stop services:

```bash
make selfhost-stop
```

## CLI And Daemon

The CLI binary is still named `multica` for compatibility with the upstream
daemon/runtime code. In Origin, it should point at your local backend:

```bash
multica config set server_url http://localhost:8080
multica config set app_url http://localhost:3000
multica daemon status
```

For full CLI and daemon notes, see [`CLI_AND_DAEMON.md`](CLI_AND_DAEMON.md).

## Configuration

Start from `.env.example`. The most important variables are:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Backend database connection |
| `JWT_SECRET` | JWT signing secret; change from the example value |
| `PORT` | Backend HTTP port, default `8080` |
| `FRONTEND_ORIGIN` | Allowed desktop/dev frontend origin |
| `MULTICA_APP_URL` | CLI browser-login app URL, kept for compatibility |

Email, Google OAuth, CloudFront, and S3 variables remain in `.env.example`
because upstream-compatible handlers and tests still exist. They are not
required for the Origin local sign-in flow.

More details: [`SELF_HOSTING_ADVANCED.md`](SELF_HOSTING_ADVANCED.md).
