/**
 * Standalone Vite config for running the desktop renderer in web/browser mode.
 * Used by E2E tests (Playwright) and the CI e2e-smoke job.
 *
 * Does NOT require Electron — boots the renderer as a plain SPA so Playwright
 * can drive it with a Chromium browser. window.desktopAPI / daemonAPI / updater
 * are stubbed in each test's addInitScript call.
 *
 * @multica/* workspace packages resolve via pnpm node_modules symlinks.
 * Their package.json exports point directly to .ts source files, which
 * Vite + @vitejs/plugin-react handles natively.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.DESKTOP_RENDERER_PORT) || 5173;

export default {
  root: resolve(desktopRoot, "src/renderer"),
  server: {
    // Use localhost (not 127.0.0.1) so the browser Origin header matches the
    // backend's CORS allowlist entry "http://localhost:5173".
    host: "localhost",
    port,
    strictPort: true,
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Desktop renderer src shorthand (@/components/... etc.)
      "@": resolve(desktopRoot, "src/renderer/src"),
    },
    dedupe: ["react", "react-dom"],
    // Follow symlinks so pnpm workspace package symlinks resolve correctly
    preserveSymlinks: false,
  },
  // Skip pre-bundling for workspace packages — they export .ts source directly
  // and pre-bundling would need an extra transform step. Vite handles .ts fine.
  optimizeDeps: {
    exclude: ["@multica/core", "@multica/ui", "@multica/views"],
  },
};
