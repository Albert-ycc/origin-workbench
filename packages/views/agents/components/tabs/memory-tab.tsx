"use client";

import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@multica/core/types";
import { agentMemoriesOptions } from "@multica/core/agents/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { MemorySection } from "./journal-tab";

export function MemoryTab({ agent }: { agent: Agent }) {
  const wsId = useWorkspaceId();
  const { data } = useQuery(agentMemoriesOptions(wsId, agent.id));

  return <MemorySection memories={data?.memories ?? []} limit={12} />;
}
