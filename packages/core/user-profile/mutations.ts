import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { userProfileKeys } from "./queries";
import type { UpsertUserProfileRequest, UserProfile } from "../types";

export function useUpsertUserProfile() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: UpsertUserProfileRequest) => api.upsertUserProfile(data),
    onSuccess: (profile: UserProfile) => {
      qc.setQueryData(userProfileKeys.all(wsId), profile);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: userProfileKeys.all(wsId) });
    },
  });
}
