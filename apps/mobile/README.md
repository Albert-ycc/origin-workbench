# Origin Mobile

Origin Mobile is the self-use phone entry point for Origin Workbench. It is a Vite/React mobile shell that can run as a LAN PWA today and is prepared for iPhone direct install through Capacitor.

## Current Scope

- Mobile workspace package: `@multica/mobile`.
- PWA manifest and icons: `public/manifest.webmanifest`, `public/icons/`.
- Capacitor config: `capacitor.config.ts`.
- Mobile UI shell: connection settings, mission cockpit, agent roster, ideas, inbox, and risk radar.
- Origin API wiring: local sign-in, workspace loading, missions, ideas, agents, inbox, and demo fallback.
- Local readiness check: `scripts/doctor.mjs`.

## Prerequisites

- Node.js and pnpm matching the root workspace.
- Origin backend running on the Mac.
- For iOS direct install: macOS, Xcode, and an Apple developer team configured in Xcode.

## Local Dev

```bash
cd /Users/albert/OriginWorkbenchMount/server
pnpm install
pnpm --filter @multica/mobile dev
```

The Vite dev server binds to all interfaces. Open the local URL on the Mac, or open the LAN URL from the phone when the phone and Mac are on the same Wi-Fi.

```bash
ipconfig getifaddr en0
```

Phone URL format:

```text
http://<MAC_LAN_IP>:5173
```

If Vite chooses a different port, use that port instead.

## Connect To Origin Backend

Start the Origin backend on the Mac, then enter the backend URL in the mobile connection panel:

```text
http://<MAC_LAN_IP>:8080
```

If the backend rejects browser calls from the phone, allow the mobile origin in backend CORS configuration, for example:

```bash
CORS_ALLOWED_ORIGINS=http://<MAC_LAN_IP>:5173,capacitor://localhost
```

## Checks

```bash
cd /Users/albert/OriginWorkbenchMount/server
node apps/mobile/scripts/doctor.mjs
pnpm --filter @multica/mobile typecheck
pnpm --filter @multica/mobile build
```

## PWA Self Install

1. Open `http://<MAC_LAN_IP>:5173` on iPhone Safari.
2. Tap Share.
3. Tap Add to Home Screen.

The current icons are SVG placeholders. Replace them with production PNG assets before treating the PWA as polished:

```text
192x192 PNG
512x512 PNG
512x512 maskable PNG
```

## iOS Direct Install With Capacitor

Build the mobile web assets:

```bash
cd /Users/albert/OriginWorkbenchMount/server
pnpm --filter @multica/mobile build
```

Generate and open the native iOS project when you are ready to install to a device:

```bash
cd /Users/albert/OriginWorkbenchMount/server/apps/mobile
pnpm exec cap add ios
pnpm exec cap sync ios
pnpm exec cap open ios
```

In Xcode:

1. Select the app target.
2. Set Signing & Capabilities to your team.
3. Connect the iPhone by USB or wireless debugging.
4. Choose the device and run.

For local development against a LAN backend, keep API base URL configurable in the app instead of committing a device-specific server URL.
