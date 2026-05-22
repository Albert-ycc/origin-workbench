import { describe, expect, it } from "vitest";

import { getRoomAmbientTheme } from "./room-ambient-theme";

describe("getRoomAmbientTheme", () => {
  it.each([
    ["morning", "2026-05-22T06:30:00+08:00"],
    ["day", "2026-05-22T12:00:00+08:00"],
    ["evening", "2026-05-22T18:30:00+08:00"],
    ["night", "2026-05-22T23:30:00+08:00"],
    ["night", "2026-05-22T02:30:00+08:00"],
  ] as const)("returns %s for %s", (expected, iso) => {
    expect(getRoomAmbientTheme(new Date(iso))).toBe(expected);
  });
});
