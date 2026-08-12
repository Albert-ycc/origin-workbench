import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({
  api: {
    initiateListModels: vi.fn(),
    getListModelsResult: vi.fn(),
  },
}));

import { api } from "../api";
import type { AgentRuntime } from "../types";
import {
  aggregateRuntimeModelsOptions,
  type AggregatedRuntimeModel,
} from "./models";

function cloudRuntime(id: string, name: string): AgentRuntime {
  return {
    id,
    workspace_id: "ws-1",
    daemon_id: `daemon:${id}`,
    name,
    runtime_mode: "cloud",
    provider: "custom",
    launch_header: "",
    status: "online",
    device_info: "",
    metadata: {},
    owner_id: null,
    last_seen_at: null,
    created_at: "",
    updated_at: "",
  };
}

describe("aggregateRuntimeModelsOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // queryOptions widens queryFn to a QueryFunction (1-arg); our fn is a
  // zero-arg closure, so unwrap it for direct invocation in tests.
  const run = (runtimes: AgentRuntime[]) => {
    const options = aggregateRuntimeModelsOptions(runtimes);
    const queryFn = options.queryFn as unknown as () => Promise<
      AggregatedRuntimeModel[]
    >;
    return queryFn();
  };

  it("skips a cloud runtime whose provider reports supported=false", async () => {
    vi.mocked(api.initiateListModels).mockResolvedValue({
      id: "req-1",
      runtime_id: "rt-cloud",
      status: "completed",
      models: [{ id: "m-1", label: "m-1" }],
      supported: false,
      created_at: "",
      updated_at: "",
    });

    const result = await run([cloudRuntime("rt-cloud", "Cloud")]);

    expect(result).toEqual([]);
  });

  it("aggregates models from a supported cloud runtime", async () => {
    vi.mocked(api.initiateListModels).mockResolvedValue({
      id: "req-1",
      runtime_id: "rt-cloud",
      status: "completed",
      models: [{ id: "m-1", label: "m-1" }],
      supported: true,
      created_at: "",
      updated_at: "",
    });

    const result = await run([cloudRuntime("rt-cloud", "Cloud")]);

    expect(result).toEqual([
      expect.objectContaining({
        id: "m-1",
        runtime_id: "rt-cloud",
        runtime_name: "Cloud",
      }),
    ]);
  });
});
