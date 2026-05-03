import { defaultAvatarFor } from "./avatar-picker";

/**
 * True if the value can be used directly as an <img> src — http(s) URLs,
 * data URIs, blob URLs, or absolute paths. Anything else (a bare emoji, an
 * empty string) is treated as "not a real avatar" and falls back to the
 * Lorelei default set.
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
 * Deterministic default avatar from the bundled AVATAR_SET (30 Lorelei
 * presets). Same seed always returns the same avatar, so a user without a
 * chosen avatar still sees a stable identity.
 */
export function loreleiDefaultAvatar(name?: string | null): string {
  return defaultAvatarFor(name);
}

/**
 * Resolve which URL to actually render: the user's chosen avatar if it looks
 * like a real URL, else a deterministic Lorelei default seeded by `name`.
 */
export function resolveUserAvatarUrl(
  avatarUrl?: string | null,
  name?: string | null,
): string {
  return isRenderableAvatarUrl(avatarUrl) ? avatarUrl : loreleiDefaultAvatar(name);
}
