import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const userProfileKeys = {
  // Workspace-scoped because the profile is per (workspace, user). When the
  // workspace changes we want a fresh fetch; when only the user_id portion of
  // the same workspace changes the cache key still differs naturally because
  // wsId is the only variable input from the client (server resolves user
  // from JWT).
  all: (wsId: string) => ["user-profile", wsId] as const,
};

export function userProfileOptions(wsId: string) {
  return queryOptions({
    queryKey: userProfileKeys.all(wsId),
    queryFn: () => api.getUserProfile(),
    enabled: !!wsId,
  });
}
