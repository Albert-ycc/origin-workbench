import { shell } from "electron";

// True when the URL parses and uses plain http/https without embedded
// credentials — the only URLs we let reach `shell.openExternal`.
export function isSafeExternalHttpUrl(url: string): boolean {
  return getSafeHttpUrl(url) !== null;
}

// Canonical wrapper around shell.openExternal. All renderer-controlled URLs
// that eventually reach the OS shell MUST flow through here; direct calls
// to `shell.openExternal` elsewhere in the main process are banned by the
// no-restricted-syntax rule in apps/desktop/eslint.config.mjs.
export function openExternalSafely(url: string): Promise<void> | void {
  const safeUrl = getSafeHttpUrl(url);
  if (safeUrl === null) {
    console.warn(`[security] blocked openExternal: ${describeScheme(url)}`);
    return;
  }
  return shell.openExternal(safeUrl.href);
}

function getSafeHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.username !== "" || parsed.password !== "") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function describeScheme(url: string): string {
  try {
    return `scheme=${new URL(url).protocol}`;
  } catch {
    return "invalid URL";
  }
}
