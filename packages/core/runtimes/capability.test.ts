import { describe, expect, it } from "vitest";
import {
  deriveRuntimeCapability,
  deriveAgentRuntimeCapability,
  runtimeCapabilityCopy,
} from "./capability";
import type { AgentRuntime } from "../types";

// ---------------------------------------------------------------------------
// deriveRuntimeCapability
// ---------------------------------------------------------------------------

describe("deriveRuntimeCapability", () => {
  const onlineLocal: AgentRuntime = {
    id: "r1", workspace_id: "ws1", daemon_id: "d1", name: "local",
    runtime_mode: "local", provider: "claude", launch_header: "cli",
    status: "online", device_info: "{}", metadata: {}, owner_id: null,
    last_seen_at: new Date().toISOString(), created_at: "", updated_at: "",
  } as AgentRuntime;

  const onlineCloud: AgentRuntime = {
    ...onlineLocal,
    id: "r2",
    runtime_mode: "cloud",
    provider: "anthropic",
  } as AgentRuntime;

  const offline: AgentRuntime = {
    ...onlineLocal,
    id: "r3",
    status: "offline",
  } as AgentRuntime;

  it("returns unavailable for null/undefined runtime", () => {
    expect(deriveRuntimeCapability(null)).toBe("unavailable");
    expect(deriveRuntimeCapability(undefined)).toBe("unavailable");
  });

  it("returns unavailable for offline runtime", () => {
    expect(deriveRuntimeCapability(offline)).toBe("unavailable");
  });

  it("returns api_readonly for cloud runtime", () => {
    expect(deriveRuntimeCapability(onlineCloud)).toBe("api_readonly");
  });

  it("returns local_execute for online local runtime", () => {
    expect(deriveRuntimeCapability(onlineLocal)).toBe("local_execute");
  });
});

// ---------------------------------------------------------------------------
// deriveAgentRuntimeCapability
// ---------------------------------------------------------------------------

describe("deriveAgentRuntimeCapability", () => {
  const agent = {
    archived_at: null,
    runtime_mode: "local" as const,
    runtime_config: {},
  };

  const runtime: AgentRuntime = {
    id: "r1", workspace_id: "ws1", daemon_id: "d1", name: "local",
    runtime_mode: "local", provider: "claude", launch_header: "cli",
    status: "online", device_info: "{}", metadata: {}, owner_id: null,
    last_seen_at: new Date().toISOString(), created_at: "", updated_at: "",
  } as AgentRuntime;

  it("returns unavailable for archived agent", () => {
    const archived = { ...agent, archived_at: "2025-01-01T00:00:00Z" };
    expect(deriveAgentRuntimeCapability(archived, runtime)).toBe("unavailable");
  });

  it("returns unavailable when runtime is null", () => {
    expect(deriveAgentRuntimeCapability(agent, null)).toBe("unavailable");
  });

  it("returns api_readonly for cloud runtime", () => {
    const cloudRuntime = { ...runtime, runtime_mode: "cloud" as const };
    expect(deriveAgentRuntimeCapability(agent, cloudRuntime)).toBe("api_readonly");
  });

  it("returns local_execute for online local runtime", () => {
    expect(deriveAgentRuntimeCapability(agent, runtime)).toBe("local_execute");
  });
});

// ---------------------------------------------------------------------------
// runtimeCapabilityCopy
// ---------------------------------------------------------------------------

describe("runtimeCapabilityCopy", () => {
  it("has entries for all three capability kinds", () => {
    const kinds = Object.keys(runtimeCapabilityCopy);
    expect(kinds).toHaveLength(3);
    expect(kinds).toContain("api_readonly");
    expect(kinds).toContain("local_execute");
    expect(kinds).toContain("unavailable");
  });

  it("each entry has a non-empty label and className", () => {
    for (const entry of Object.values(runtimeCapabilityCopy)) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.badgeClassName.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});
