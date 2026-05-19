import { describe, expect, it } from "vitest";
import { normalizeProfileName } from "./account-tab";

describe("normalizeProfileName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeProfileName("  Alice Chen \n")).toBe("Alice Chen");
  });

  it("returns an empty string for whitespace-only names", () => {
    expect(normalizeProfileName(" \t\n ")).toBe("");
  });
});
