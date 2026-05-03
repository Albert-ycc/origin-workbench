# Origin Local Setup For AI Agents

This is the short, executable path for an AI agent taking over the local Origin
workspace.

## Goal

Run the Origin backend and desktop shell from the current checkout. Do not
clone upstream Multica, do not install the upstream Homebrew tap, and do not
start a removed Web frontend.

## Steps

```bash
cd origin-workbench
pnpm install
make selfhost
pnpm dev:desktop
```

Expected state:

- Backend health: `http://localhost:8080/health`
- Docker image: `origin-backend:dev`
- Desktop shell: Electron app opened by `pnpm dev:desktop`
- Login: local nickname + avatar, no email code

## Daemon Check

```bash
multica config set server_url http://localhost:8080
multica config set app_url http://localhost:3000
multica daemon status
```

At least one supported local runtime should be on `PATH`, for example `claude`,
`codex`, `gemini`, `cursor-agent`, `opencode`, `openclaw`, or `hermes`.

## Stop

```bash
multica daemon stop
make selfhost-stop
```

## Troubleshooting

```bash
docker compose -f docker-compose.selfhost.yml logs backend
curl http://localhost:8080/health
pnpm --filter @multica/desktop typecheck
```
