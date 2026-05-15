import { api } from "@multica/core/api";
import { defaultAvatarFor } from "./avatar-picker";

/**
 * True if the value can be used directly as an <img> src — http(s) URLs,
 * data URIs, blob URLs, or absolute paths. Anything else (a bare emoji, an
 * empty string) is treated as "not a real avatar" and falls back to the
 * bundled Origin avatar set.
 */
export function isRenderableAvatarUrl(value?: string | null): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("/")
  );
}

/**
 * Rewrite a server-relative asset path ("/uploads/...") to an absolute URL
 * the renderer can fetch. Origin runs as an Electron app whose renderer
 * origin is not the backend, so a bare "/uploads/..." resolves against the
 * app's own scheme (file:// or app:///) and the image silently fails to
 * load. Prefixing the configured API base URL makes the renderer hit the
 * backend instead.
 *
 * Already-absolute URLs (http/https/data/blob) pass through unchanged.
 */
export function resolveAssetUrl(value: string): string {
  if (!value.startsWith("/")) return value;
  try {
    const base = api.getBaseUrl?.();
    if (!base) return value;
    return `${base.replace(/\/+$/, "")}${value}`;
  } catch {
    // ApiClient not initialised yet (SSR / tests). Fall back to the raw path;
    // image will still fail to load but the render won't crash.
    return value;
  }
}

/**
 * Deterministic default avatar from the bundled AVATAR_SET. Same seed always
 * returns the same avatar, so a user without a chosen avatar still sees a
 * stable identity.
 */
export function originDefaultAvatar(name?: string | null): string {
  return defaultAvatarFor(name);
}

/**
 * Resolve which URL to actually render: the user's chosen avatar if it looks
 * like a real URL (rewritten through resolveAssetUrl when it's a server-side
 * path), else a deterministic Origin default seeded by `name`.
 */
export function resolveUserAvatarUrl(
  avatarUrl?: string | null,
  name?: string | null,
): string {
  if (!isRenderableAvatarUrl(avatarUrl)) {
    return originDefaultAvatar(name);
  }
  return resolveAssetUrl(avatarUrl);
}
