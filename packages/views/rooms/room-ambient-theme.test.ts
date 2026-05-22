import { describe, expect, it } from "vitest";

import { getRoomAmbientTheme } from "./room-ambient-theme";

describe("getRoomAmbientTheme", () => {
  it.each([
    ["morning", new Date(2026, 4, 22, 6, 30)],
    ["day", new Date(2026, 4, 22, 12, 0)],
    ["evening", new Date(2026, 4, 22, 18, 30)],
    ["night", new Date(2026, 4, 22, 23, 30)],
    ["night", new Date(2026, 4, 22, 2, 30)],
  ] as const)("returns %s for local time %s", (expected, date) => {
    expect(getRoomAmbientTheme(date)).toBe(expected);
  });
});
