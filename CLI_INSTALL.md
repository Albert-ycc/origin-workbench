# Origin CLI Install Guide

Origin keeps the internal CLI command name `multica` for compatibility with
the daemon and desktop app. Public product usage is local-first: run the
backend on `localhost`, open the desktop app, then use the local name + avatar
sign-in flow.

## Install From GitHub Releases

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Albert-ycc/origin-workbench/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Albert-ycc/origin-workbench/main/scripts/install.ps1 | iex
```

Verify:

```bash
multica version
```

## Run Local Backend

```bash
curl -fsSL https://raw.githubusercontent.com/Albert-ycc/origin-workbench/main/scripts/install.sh | bash -s -- --with-server
```

Or from a cloned checkout:

```bash
pnpm install
make selfhost
pnpm dev:desktop
```

`make selfhost` builds `origin-backend:dev` from the current checkout and starts
PostgreSQL + backend. There is no public Origin Cloud and no hosted workspace
login flow.

## Connect The Daemon

After the backend is running:

```bash
multica setup self-host
multica daemon status
```

The daemon detects local AI CLIs on your `PATH`, such as `claude`, `codex`,
`gemini`, `opencode`, `openclaw`, `hermes`, `pi`, and `cursor-agent`.

Useful checks:

```bash
multica auth status
multica runtime list
multica daemon logs -f
```

## Notes For AI Agents

- Do not use upstream package-manager or hosted-login instructions.
- Keep users on the local backend + desktop sign-in flow.
- Origin Desktop is the primary product shell; web/docs surfaces are not part
  of the public local-first flow.
- The CLI command is still `multica` until the daemon/desktop runtime contract
  is renamed end-to-end.
