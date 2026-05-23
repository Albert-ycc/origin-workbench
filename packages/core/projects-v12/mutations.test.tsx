// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiInstance } from "../api";
import type { ApiClient } from "../api";
import { explorationKeys } from "../explorations/queries";
import { ideaKeys } from "../ideas/queries";
import { meetingKeys } from "../meetings/queries";
import { missionKeys } from "../missions/queries";
import { toolBindingKeys } from "../tool-bindings/queries";
import { projectV12Keys } from "./queries";
import { useDeleteProjectV12 } from "./mutations";

const wsId = "ws-1";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>) {
  type InvalidateCall = [{ queryKey?: unknown }?, ...unknown[]];
  return (spy.mock.calls as InvalidateCall[]).map(([filters]) => filters?.queryKey);
}

describe("useDeleteProjectV12", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invalidates project-scoped resource caches after deleting a project workspace", async () => {
    const qc = createQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const removeSpy = vi.spyOn(qc, "removeQueries");
    setApiInstance({
      deleteProjectV12: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient);

    const { result } = renderHook(() => useDeleteProjectV12(wsId), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate("project-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(removeSpy).toHaveBeenCalledWith({
      queryKey: projectV12Keys.detail(wsId, "project-1"),
    });
    expect(removeSpy).toHaveBeenCalledWith({
      queryKey: projectV12Keys.mainChat(wsId, "project-1"),
    });
    expect(removeSpy).toHaveBeenCalledWith({
      queryKey: projectV12Keys.mainChatMessages(wsId, "project-1"),
    });
    expect(removeSpy).toHaveBeenCalledWith({
      queryKey: projectV12Keys.archivedSessions(wsId, "project-1"),
    });
    expect(invalidatedKeys(invalidateSpy)).toEqual(
      expect.arrayContaining([
        projectV12Keys.all(wsId),
        missionKeys.all(wsId),
        ideaKeys.all(wsId),
        explorationKeys.all(wsId),
        meetingKeys.all(wsId),
        toolBindingKeys.all(wsId),
      ]),
    );
  });
});
