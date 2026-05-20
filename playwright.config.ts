import "./e2e/env";
import { defineConfig } from "@playwright/test";

// In CI the webServer is managed externally (ci.yml starts backend + renderer
// before running Playwright). Locally, set PLAYWRIGHT_NO_WEBSERVER=1 if you
// already have both services running, otherwise the webServer block below
// starts a renderer-only dev server against an already-running backend.
const skipWebServer =
  process.env.CI === "true" || process.env.PLAYWRIGHT_NO_WEBSERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  retries: process.env.CI === "true" ? 1 : 0,
  // Run smoke tests sequentially so a single DB + backend handles the load
  // without concurrency contention. Each test creates its own isolated user +
  // workspace so ordering doesn't matter, but parallel would race on DB writes.
  workers: 1,
  use: {
    // Must match the backend CORS allowlist (http://localhost:5173).
    // Do NOT use 127.0.0.1 — the browser sends that as the Origin header,
    // which the backend rejects even though they resolve to the same IP.
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ??
      `http://localhost:${process.env.DESKTOP_RENDERER_PORT ?? "5173"}`,
    headless: true,
    locale: "zh-CN",
    // Capture trace on failure for easier debugging in CI artifact downloads
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        // In CI, Playwright's installed chromium is used (playwright install).
        // Locally, if the matching headless-shell version isn't installed,
        // fall back to the system Google Chrome to avoid a forced download.
        ...(process.env.CI !== "true" && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : process.env.CI !== "true"
          ? { channel: "chrome" }
          : {}),
      },
    },
  ],
  // Only spin up a local renderer dev-server when not in CI and not suppressed.
  // The backend must already be running (make selfhost or docker compose).
  ...(skipWebServer
    ? {}
    : {
        webServer: {
          command: [
            "pnpm exec vite",
            "--config apps/desktop/.origin-e2e-vite.config.mjs",
            `--port ${process.env.DESKTOP_RENDERER_PORT ?? "5173"}`,
          ].join(" "),
          url: `http://localhost:${process.env.DESKTOP_RENDERER_PORT ?? "5173"}`,
          timeout: 120000,
          reuseExistingServer: true,
        },
      }),
});
