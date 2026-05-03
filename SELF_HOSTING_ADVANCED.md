# Origin Local Hosting — Advanced Notes

This document records the backend and daemon configuration that still matters
after Origin removed the upstream Web/SaaS product shell.

## Runtime Shape

Origin runs as:

1. PostgreSQL with pgvector.
2. Go backend on `localhost:8080`.
3. Electron desktop app as the user-facing shell.
4. Local daemon/CLI for runtime discovery and task execution.

The removed upstream Web frontend, Google OAuth login, email verification UI,
member invitations, and cloud workspace flows are not supported product paths.

## Required Backend Variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://multica:multica@localhost:5432/multica?sslmode=disable` |
| `JWT_SECRET` | JWT signing secret. Change it before exposing the backend. | `openssl rand -hex 32` |
| `PORT` | Backend HTTP port | `8080` |
| `FRONTEND_ORIGIN` | Allowed frontend origin for local desktop/dev browser flows | `http://localhost:3000` |

Optional pool tuning:

| Variable | Default |
|---|---|
| `DATABASE_MAX_CONNS` | `25` |
| `DATABASE_MIN_CONNS` | `5` |

## Local Sign-In

Origin's primary login is `/auth/local-signin`: nickname + avatar, single local
user, default local workspace. It does not require Resend, Google OAuth, or a
verification code.

The following variables remain for legacy upstream-compatible handlers and
tests only:

| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | Leave empty for Origin local sign-in. |
| `RESEND_FROM_EMAIL` | Defaults to `noreply@localhost.local`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Not used by the Origin primary flow. |
| `MULTICA_DEV_VERIFICATION_CODE` | Legacy deterministic email-code shortcut; ignored in production. |

## File Storage

For local use, prefer filesystem uploads:

| Variable | Default |
|---|---|
| `LOCAL_UPLOAD_DIR` | `./data/uploads` |
| `LOCAL_UPLOAD_BASE_URL` | `http://localhost:8080` |

S3 and CloudFront variables are preserved for compatibility with upstream
storage code, but they are not required for a local Origin desktop install.

## CLI / Daemon

The CLI binary remains named `multica`. Configure it against the local backend:

```bash
multica config set server_url http://localhost:8080
multica config set app_url http://localhost:3000
multica daemon start
```

Daemon-related variables:

| Variable | Default | Description |
|---|---|---|
| `MULTICA_SERVER_URL` | `ws://localhost:8080/ws` | Daemon WebSocket URL |
| `MULTICA_APP_URL` | `http://localhost:3000` | Browser-login compatibility URL |
| `MULTICA_DAEMON_POLL_INTERVAL` | `3s` | Task polling interval |
| `MULTICA_DAEMON_HEARTBEAT_INTERVAL` | `15s` | Runtime heartbeat interval |

Agent runtime overrides:

| Variable | Description |
|---|---|
| `MULTICA_CLAUDE_PATH` | Custom `claude` binary path |
| `MULTICA_CODEX_PATH` | Custom `codex` binary path |
| `MULTICA_GEMINI_PATH` | Custom `gemini` binary path |
| `MULTICA_CURSOR_PATH` | Custom `cursor-agent` binary path |
| `MULTICA_OPENCODE_PATH` | Custom `opencode` binary path |
| `MULTICA_OPENCLAW_PATH` | Custom `openclaw` binary path |
| `MULTICA_HERMES_PATH` | Custom `hermes` binary path |

## Manual Backend Setup

```bash
pnpm install
make db-up
cd server && go run ./cmd/migrate up
cd server && go run ./cmd/server
```

In another terminal:

```bash
pnpm dev:desktop
```

## Docker Compose

Build from the current checkout:

```bash
docker compose -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml up -d --build
```

Only PostgreSQL and the backend are defined. The desktop app is built and run
outside Compose.

## Reverse Proxy

Origin is designed for localhost. If you expose the backend on a LAN or through
a reverse proxy, terminate TLS at the proxy and set:

```bash
FRONTEND_ORIGIN=https://your-desktop-or-dev-origin.example
CORS_ALLOWED_ORIGINS=https://your-desktop-or-dev-origin.example
COOKIE_DOMAIN=
```

Leave `COOKIE_DOMAIN` empty unless you are deliberately serving multiple
subdomains under one registered domain. Do not use IP literals in
`COOKIE_DOMAIN`.
