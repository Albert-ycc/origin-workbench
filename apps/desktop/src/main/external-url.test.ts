import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}));

import { shell } from "electron";
import { isSafeExternalHttpUrl, openExternalSafely } from "./external-url";

describe("isSafeExternalHttpUrl", () => {
  it("allows http and https URLs", () => {
    expect(isSafeExternalHttpUrl("https://github.com/Albert-ycc/origin-workbench")).toBe(
      true,
    );
    expect(isSafeExternalHttpUrl("http://localhost:3000/auth")).toBe(true);
  });

  it("rejects http/https URLs with embedded credentials", () => {
    expect(isSafeExternalHttpUrl("https://user:pass@example.com")).toBe(false);
    expect(isSafeExternalHttpUrl("https://user@example.com")).toBe(false);
    expect(isSafeExternalHttpUrl("http://:pass@example.com")).toBe(false);
  });

  it("normalizes scheme casing so uppercase variants can't bypass", () => {
    expect(isSafeExternalHttpUrl("HTTPS://example.com")).toBe(true);
    expect(isSafeExternalHttpUrl("FILE:///etc/passwd")).toBe(false);
  });

  it("rejects dangerous pseudo-schemes", () => {
    expect(isSafeExternalHttpUrl("javascript:alert(1)")).toBe(false);
    expect(
      isSafeExternalHttpUrl("data:text/html,<script>alert(1)</script>"),
    ).toBe(false);
  });

  it("rejects filesystem and network transport schemes", () => {
    expect(isSafeExternalHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalHttpUrl("ftp://example.com/x")).toBe(false);
    expect(isSafeExternalHttpUrl("smb://share/x")).toBe(false);
  });

  it("rejects local-handler schemes used in past RCE chains", () => {
    expect(isSafeExternalHttpUrl("vscode://file/test")).toBe(false);
    expect(isSafeExternalHttpUrl("ms-msdt:/id%20PCWDiagnostic")).toBe(false);
  });

  it("rejects mailto and other non-web schemes", () => {
    expect(isSafeExternalHttpUrl("mailto:test@example.com")).toBe(false);
    expect(isSafeExternalHttpUrl("tel:+15551234567")).toBe(false);
  });

  it("rejects empty, whitespace, and malformed input", () => {
    expect(isSafeExternalHttpUrl("")).toBe(false);
    expect(isSafeExternalHttpUrl(" ")).toBe(false);
    expect(isSafeExternalHttpUrl("not a url")).toBe(false);
    expect(isSafeExternalHttpUrl("http://")).toBe(false);
  });
});

describe("openExternalSafely", () => {
  beforeEach(() => {
    vi.mocked(shell.openExternal).mockClear();
  });

  it("forwards http/https URLs to shell.openExternal", () => {
    openExternalSafely("https://github.com/Albert-ycc/origin-workbench");
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://github.com/Albert-ycc/origin-workbench",
    );
  });

  it("canonicalizes accepted URLs before handing them to the OS shell", () => {
    openExternalSafely(" HTTPS://EXAMPLE.com/auth ");
    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com/auth");
  });

  it("does not call shell.openExternal for rejected schemes", () => {
    openExternalSafely("file:///etc/passwd");
    openExternalSafely("javascript:alert(1)");
    openExternalSafely("not a url");
    openExternalSafely("https://user:pass@example.com");
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});
