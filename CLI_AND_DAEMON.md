# Origin CLI And Agent Daemon

Origin is a local-first desktop workbench. The backend and daemon still reuse
the upstream `multica` CLI command name internally, but public usage should be
understood as Origin local runtime plumbing.

## Quick Start

From this checkout:

```bash
pnpm install
make selfhost
pnpm dev:desktop
```

Then connect the local daemon:

```bash
multica setup self-host
multica daemon status
```

`make selfhost` starts PostgreSQL and builds `origin-backend:dev` from the
current checkout. The Electron desktop app talks to the backend on
`http://localhost:8080`.

## What The Daemon Does

The daemon is the local execution layer:

1. Detects available AI CLIs on your machine.
2. Registers those runtimes with the local backend.
3. Claims work assigned by Origin.
4. Creates isolated task workdirs.
5. Streams task messages, progress, and results back to the backend.

Supported local CLI providers include:

| Provider | Command |
| --- | --- |
| Claude Code | `claude` |
| Codex | `codex` |
| Gemini | `gemini` |
| Cursor Agent | `cursor-agent` |
| OpenCode | `opencode` |
| OpenClaw | `openclaw` |
| Hermes | `hermes` |
| Pi | `pi` |
| Kimi | `kimi` |
| Kiro CLI | `kiro-cli` |

## Common Commands

```bash
multica version
multica setup self-host
multica auth status
multica runtime list
multica daemon start
multica daemon stop
multica daemon status
multica daemon logs -f
```

## Configuration

Daemon behavior is configured through flags or environment variables.

| Setting | Env Variable | Default |
| --- | --- | --- |
| Poll interval | `MULTICA_DAEMON_POLL_INTERVAL` | `3s` |
| Heartbeat interval | `MULTICA_DAEMON_HEARTBEAT_INTERVAL` | `15s` |
| Agent timeout | `MULTICA_AGENT_TIMEOUT` | `2h` |
| Max concurrent tasks | `MULTICA_DAEMON_MAX_CONCURRENT_TASKS` | `20` |
| Daemon ID | `MULTICA_DAEMON_ID` | hostname |
| Device name | `MULTICA_DAEMON_DEVICE_NAME` | hostname |
| Workdirs root | `MULTICA_WORKSPACES_ROOT` | `~/multica_workspaces` |

Provider-specific overrides:

| Provider | Path Env | Model Env |
| --- | --- | --- |
| Claude Code | `MULTICA_CLAUDE_PATH` | `MULTICA_CLAUDE_MODEL` |
| Codex | `MULTICA_CODEX_PATH` | `MULTICA_CODEX_MODEL` |
| Gemini | `MULTICA_GEMINI_PATH` | `MULTICA_GEMINI_MODEL` |
| Cursor Agent | `MULTICA_CURSOR_PATH` | `MULTICA_CURSOR_MODEL` |
| OpenCode | `MULTICA_OPENCODE_PATH` | `MULTICA_OPENCODE_MODEL` |
| OpenClaw | `MULTICA_OPENCLAW_PATH` | `MULTICA_OPENCLAW_MODEL` |
| Hermes | `MULTICA_HERMES_PATH` | `MULTICA_HERMES_MODEL` |
| Pi | `MULTICA_PI_PATH` | `MULTICA_PI_MODEL` |
| Kimi | `MULTICA_KIMI_PATH` | `MULTICA_KIMI_MODEL` |
| Kiro | `MULTICA_KIRO_PATH` | `MULTICA_KIRO_MODEL` |

Extra arguments for Claude Code and Codex can be set with
`MULTICA_CLAUDE_ARGS` and `MULTICA_CODEX_ARGS`.

## Local Backend

Manual local backend configuration:

```bash
multica config set server_url http://localhost:8080
multica config set app_url http://localhost:3000
multica setup self-host
```

Origin does not ship a public hosted cloud flow. Do not use upstream hosted
login or invitation setup instructions for this fork.

## Troubleshooting

No runtimes detected:

```bash
which claude codex gemini cursor-agent opencode openclaw hermes pi
multica daemon restart
```

Daemon logs:

```bash
multica daemon logs -f --lines 100
```

Backend health:

```bash
curl http://localhost:8080/health
docker compose -f docker-compose.selfhost.yml logs backend
```
