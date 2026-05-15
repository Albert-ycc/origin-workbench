export type MeetingStatus =
  | "draft"
  | "running"
  | "stopped"
  | "summarizing"
  | "completed"
  | "archived";

export type MeetingAnalysisStatus = "idle" | "running" | "paused" | "failed" | "completed";
export type MeetingReminderMode = "strong" | "review" | "quiet";
export type MeetingReminderIntensity = "conservative" | "standard" | "aggressive";
export type MeetingASRProvider = "renderer" | "local" | "external" | "manual";
export type MeetingModelSource = "not_configured" | "local" | "external";
export type MeetingInsightType = "question" | "risk" | "feedback" | "tension" | "summary";
export type MeetingInsightSeverity = "L1" | "L2" | "L3";
export type MeetingInsightStatus =
  | "open"
  | "asked"
  | "accepted"
  | "ignored"
  | "post_meeting"
  | "resolved";

export interface MeetingStrategy {
  focus?: string[];
  blocked_topics?: string[];
  expected_outcomes?: string[];
  [key: string]: unknown;
}

export interface MeetingSession {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  goal: string;
  user_role: string;
  strategy: MeetingStrategy;
  reminder_mode: MeetingReminderMode;
  reminder_intensity: MeetingReminderIntensity;
  sound_enabled: boolean;
  asr_provider: MeetingASRProvider;
  model_source: MeetingModelSource;
  analysis_status: MeetingAnalysisStatus;
  status: MeetingStatus;
  created_by_user_id: string;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListMeetingSessionsResponse {
  meetings: MeetingSession[];
  total: number;
}

export interface CreateMeetingSessionRequest {
  project_id: string;
  title: string;
  goal?: string;
  user_role?: string;
  strategy?: MeetingStrategy;
  reminder_mode?: MeetingReminderMode;
  reminder_intensity?: MeetingReminderIntensity;
  sound_enabled?: boolean;
  asr_provider?: MeetingASRProvider;
  model_source?: MeetingModelSource;
  analysis_enabled?: boolean;
}

export interface UpdateMeetingSessionRequest {
  title?: string;
  goal?: string;
  user_role?: string;
  strategy?: MeetingStrategy;
  reminder_mode?: MeetingReminderMode;
  reminder_intensity?: MeetingReminderIntensity;
  sound_enabled?: boolean;
  model_source?: MeetingModelSource;
  analysis_enabled?: boolean;
}

export interface MeetingTranscriptSegment {
  id: string;
  workspace_id: string;
  project_id: string;
  meeting_id: string;
  seq: number;
  started_at: string | null;
  ended_at: string | null;
  speaker_label: string;
  text: string;
  confidence: number;
  audio_offset_ms: number | null;
  source: MeetingASRProvider;
  created_at: string;
}

export interface ListMeetingTranscriptSegmentsResponse {
  segments: MeetingTranscriptSegment[];
  total: number;
}

export interface CreateMeetingTranscriptSegmentRequest {
  seq: number;
  speaker_label?: string;
  text: string;
  confidence?: number;
  source?: MeetingASRProvider;
  audio_offset_ms?: number | null;
}

export interface MeetingInsightCard {
  id: string;
  workspace_id: string;
  project_id: string;
  meeting_id: string;
  type: MeetingInsightType;
  severity: MeetingInsightSeverity;
  title: string;
  reason: string;
  suggested_question: string;
  evidence_quote: string;
  evidence_segment_id: string | null;
  evidence_start_ms: number | null;
  evidence_end_ms: number | null;
  confidence: number;
  status: MeetingInsightStatus;
  dedupe_key: string | null;
  alerted_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListMeetingInsightCardsResponse {
  cards: MeetingInsightCard[];
  total: number;
}
