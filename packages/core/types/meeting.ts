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
  asr_provider?: MeetingASRProvider;
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
  updated_at: string;
  deleted_at: string | null;
  edit_revision: number;
}

export interface ListMeetingTranscriptSegmentsResponse {
  segments: MeetingTranscriptSegment[];
  total: number;
}

export interface CreateMeetingTranscriptSegmentRequest {
  seq?: number;
  speaker_label?: string;
  text: string;
  confidence?: number;
  source?: MeetingASRProvider;
  audio_offset_ms?: number | null;
}

export interface UpdateMeetingTranscriptSegmentRequest {
  speaker_label?: string;
  text: string;
}

export interface SplitMeetingTranscriptSegmentRequest {
  text_before: string;
  text_after: string;
  speaker_label_after?: string;
}

export interface SplitMeetingTranscriptSegmentResponse {
  segments: MeetingTranscriptSegment[];
}

export interface MergeMeetingTranscriptSegmentsRequest {
  target_segment_id: string;
}

export interface MergeMeetingTranscriptSegmentsResponse {
  segment: MeetingTranscriptSegment;
  deleted_segment_id: string;
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

export interface MeetingSummary {
  meeting_id: string;
  workspace_id: string;
  project_id: string;
  summary_md: string;
  decisions: string[];
  questions: string[];
  risks: string[];
  feedback: string[];
  tensions: string[];
  action_items: string[];
  memory_candidates: string[];
  source_seq_start: number | null;
  source_seq_end: number | null;
  generated_by: string;
  duration_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface MeetingAudioAsset {
  id: string;
  workspace_id: string;
  project_id: string;
  meeting_id: string;
  filename: string;
  url: string;
  download_url: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  status: "available" | "failed" | "deleted";
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface ListMeetingAudioAssetsResponse {
  assets: MeetingAudioAsset[];
  total: number;
}

export interface SaveMeetingAudioAssetRequest {
  file: File;
  duration_seconds?: number | null;
}

export type MeetingASRJobProvider = "local" | "external" | "noop";
export type MeetingASRJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface MeetingASRJob {
  id: string;
  workspace_id: string;
  project_id: string;
  meeting_id: string;
  audio_asset_id: string;
  provider: MeetingASRJobProvider;
  status: MeetingASRJobStatus;
  error_message: string;
  retry_count: number;
  source_seq_start: number | null;
  source_seq_end: number | null;
  created_at: string;
  updated_at: string;
}

export interface ListMeetingASRJobsResponse {
  jobs: MeetingASRJob[];
  total: number;
}

export interface CreateMeetingASRJobRequest {
  provider?: MeetingASRJobProvider;
}

export interface MeetingASRProviderStatus {
  configured: boolean;
  available: boolean;
  command_name?: string;
  timeout_seconds: number;
  error?: string;
}

export interface MeetingASRStatus {
  local: MeetingASRProviderStatus;
  external: MeetingASRProviderStatus;
}
