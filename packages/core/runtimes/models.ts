import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentRuntime,
  RuntimeModel,
  RuntimeModelsResult,
} from "../types/agent";

export const runtimeModelsKeys = {
  all: () => ["runtimes", "models"] as const,
  forRuntime: (runtimeId: string) =>
    [...runtimeModelsKeys.all(), runtimeId] as const,
};

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

// resolveRuntimeModels initiates a list-models request against the daemon
// (via heartbeat piggyback) and polls until the daemon reports back or
// the request times out. Returns both the models list and a
// `supported` flag: `supported=false` means the provider ignores
// per-agent model selection entirely (hermes today) — the UI uses
// this to disable its dropdown instead of accepting a value that
// wouldn't be honoured at runtime.
export async function resolveRuntimeModels(
  runtimeId: string,
): Promise<RuntimeModelsResult> {
  const initial = await api.initiateListModels(runtimeId);
  const start = Date.now();
  let current = initial;
  while (current.status === "pending" || current.status === "running") {
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error("model discovery timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await api.getListModelsResult(runtimeId, initial.id);
  }
  if (current.status === "failed" || current.status === "timeout") {
    throw new Error(current.error || "model discovery failed");
  }
  return { models: current.models ?? [], supported: current.supported };
}

export function runtimeModelsOptions(runtimeId: string | null | undefined) {
  return queryOptions({
    queryKey: runtimeId
      ? runtimeModelsKeys.forRuntime(runtimeId)
      : runtimeModelsKeys.all(),
    queryFn: () => resolveRuntimeModels(runtimeId as string),
    enabled: Boolean(runtimeId),
    // Models rarely change; cache for 60s to match the server-side
    // cache in agent.ListModels.
    staleTime: 60_000,
    retry: false,
  });
}

// A RuntimeModel annotated with the runtime it came from. Drives the
// cross-provider model dropdown: every option can name both the model
// and the runtime to bind, so selecting a model can update runtime_id in
// the same update.
export interface AggregatedRuntimeModel extends RuntimeModel {
  runtime_id: string;
  runtime_name: string;
}

const API_RUNTIME_MARKER = "origin_api";

function isModelApiRuntime(runtime: AgentRuntime) {
  const metadata = runtime.metadata ?? {};
  return metadata.api_runtime === true && metadata.managed_by === API_RUNTIME_MARKER;
}

// Parses the server's metadata.models shape into RuntimeModel entries.
function runtimeModels(value: unknown): RuntimeModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length === 0) return [];
    return [
      {
        id: record.id,
        label:
          typeof record.label === "string" && record.label.length > 0
            ? record.label
            : record.id,
        provider: typeof record.provider === "string" ? record.provider : undefined,
        default: record.default === true,
      },
    ];
  });
}

// Aggregate the model catalog across every runnable provider so a single
// dropdown can offer "model X from runtime Y" and switch the agent's
// runtime binding in one gesture. API runtimes (metadata.api_runtime +
// managed_by origin_api) already carry their models in metadata.models, so
// they are read with zero network calls; other online cloud runtimes still
// enumerate through the daemon.
export function aggregateRuntimeModelsOptions(runtimes: AgentRuntime[]) {
  return queryOptions({
    queryKey: [
      "runtimes",
      "models",
      "aggregated",
      runtimes.map((r) => `${r.id}:${r.status}`),
    ] as const,
    queryFn: () => aggregateRuntimeModels(runtimes),
    staleTime: 60_000,
    retry: false,
  });
}

async function aggregateRuntimeModels(
  runtimes: AgentRuntime[],
): Promise<AggregatedRuntimeModel[]> {
  const out: AggregatedRuntimeModel[] = [];
  const seen = new Set<string>();

  const add = (model: RuntimeModel, runtimeId: string, runtimeName: string) => {
    const key = JSON.stringify([runtimeId, model.id]);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...model, runtime_id: runtimeId, runtime_name: runtimeName });
  };

  for (const runtime of runtimes) {
    if (runtime.status !== "online") continue;
    if (isModelApiRuntime(runtime)) {
      for (const model of runtimeModels(runtime.metadata?.models)) {
        add(model, runtime.id, runtime.name);
      }
      continue;
    }
    if (runtime.runtime_mode !== "cloud") continue;
    // One runtime failing to enumerate shouldn't blank the whole catalog.
    try {
      const result = await resolveRuntimeModels(runtime.id);
      // supported=false means the provider ignores per-agent model selection
      // entirely — skip the whole runtime so the dropdown never offers a
      // model value the runtime wouldn't honour.
      if (result.supported === false) continue;
      for (const model of result.models) {
        add(model, runtime.id, runtime.name);
      }
    } catch {
      // Ignore discovery failures for a single runtime; the rest still show.
    }
  }

  return out;
}
