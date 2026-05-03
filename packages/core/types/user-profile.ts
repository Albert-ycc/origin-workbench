export type Presence = "online" | "offline" | "dnd";

export interface UserProfile {
  /** Empty string when the profile hasn't been persisted yet (server returns
   *  a zero-value placeholder so the form can render uniformly). */
  id: string;
  workspace_id: string;
  user_id: string;
  /** Short identity card, e.g. "资深 PM / 医疗领域 / 儿童生长发育". */
  role_card: string;
  /** Long-form preferences for how Agents should communicate with the user. */
  communication_style: string;
  presence: Presence;
  /** Optional path to an external preferences source (e.g. ~/.claude/memory). */
  preferences_source_path: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertUserProfileRequest {
  role_card?: string;
  communication_style?: string;
  presence?: Presence;
  preferences_source_path?: string;
}
