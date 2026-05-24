# Meeting Recording And Transcription Product Plan

Date: 2026-05-24

## Goal

Make meeting capture reliable even when realtime transcription is unavailable. A user should be able to start a meeting, keep a recoverable audio source, collect complete transcript segments, and generate a clearly marked reviewable meeting-summary draft.

## Product Gaps

### P0 Reliable Capture Loop

- Persist meeting audio as a meeting-scoped asset, not only a temporary browser blob.
- Allocate transcript segment sequence numbers on the backend so long meetings, retries, and multiple clients do not collide.
- Keep manual transcript and imported transcript usable when realtime ASR is unavailable.
- Mark generated summaries as review drafts when they are rule-based or not backed by a configured model.
- Expose clear states for recording, upload, transcription, summary generation, and failure recovery.

### P1 Better Meeting Workflows

- Add ASR jobs that turn persisted audio assets into normalized transcript segments.
- Support retry for failed ASR jobs without duplicating transcript segments.
- Add transcript edit, merge, split, and evidence links from summary items back to source segments.
- Support chunked summary generation for long meetings.

### P2 Platform Capabilities

- Add pluggable ASR providers, including local and external providers.
- Add speaker diarization, multilingual translation, meeting-bot joins, calendar integration, retention policy, and audit trails.

## MVP Scope

This iteration focuses on product honesty and data safety:

- Backend owns transcript `seq` assignment when clients omit or send non-positive `seq`.
- Frontend no longer depends on loaded transcript length to create the next segment.
- Summary UI explicitly shows that current generated content is a review draft and may be rule-based.
- Temporary recording UI continues to warn that audio is not persisted until the meeting-audio-asset API is implemented.

Explicitly out of scope for this iteration:

- External cloud ASR integration.
- Speaker diarization.
- System audio capture.
- Meeting bot joining third-party rooms.
- Automatic publishing of meeting memory candidates.

## Target Architecture

### Meeting Audio Asset

Add a dedicated `meeting_audio_asset` domain instead of reusing issue/comment attachments.

Required fields:

- `id`
- `workspace_id`
- `project_id`
- `meeting_id`
- `storage_key` or `file_url`
- `filename`
- `mime_type`
- `size_bytes`
- `duration_seconds`
- `status`: `uploading`, `available`, `failed`, `deleted`
- `created_by_user_id`
- `created_at`
- `updated_at`

The handler may reuse the existing storage abstraction and upload validation, but the API should stay meeting-scoped:

- `POST /api/v13/meetings/{id}/audio-assets`
- `GET /api/v13/meetings/{id}/audio-assets`
- `DELETE /api/v13/meetings/{id}/audio-assets/{assetId}`

### ASR Job

Add a backend service boundary:

```go
type ASRProvider interface {
    Transcribe(ctx context.Context, input ASRInput) ([]TranscriptSegmentDraft, error)
}
```

Providers must not write directly to DB. They return normalized drafts, and the meeting service creates transcript segments through the same backend sequence allocation path.

Suggested job fields:

- `id`
- `workspace_id`
- `project_id`
- `meeting_id`
- `audio_asset_id`
- `provider`
- `status`: `queued`, `running`, `completed`, `failed`, `cancelled`
- `error_message`
- `source_seq_start`
- `source_seq_end`
- `created_at`
- `updated_at`

## Acceptance Criteria

- A manual transcript segment can be created without a client-provided `seq`; the response includes `seq = max(existing seq) + 1`.
- Existing clients that send a positive `seq` still work.
- Long-meeting import can create more than 50 segments without frontend truncation.
- The summary panel displays a visible draft/review indicator when a summary exists.
- If microphone recording fails, the page still offers manual recording/transcript fallback without blocking the meeting.
- Automated tests cover backend `seq` allocation and frontend optional `seq` payload.
- When `MEETING_ASR_LOCAL_COMMAND` is configured, saving a meeting recording can run local ASR, append transcript segments with backend-owned `seq`, and complete the ASR job with `source_seq_start/end`.
- Completed ASR jobs cannot be retried, preventing duplicate transcript insertion.

## Team Execution

- Product: maintain this plan, acceptance criteria, and P0/P1/P2 cut line.
- Architecture: own meeting-audio-asset and ASR job boundaries.
- Backend: implement sequence allocation first, then meeting audio assets and ASR jobs.
- Frontend: expose honest status, optional `seq` payload, and summary-draft labeling.
- QA: maintain regression scripts for no microphone, realtime ASR unavailable, manual transcript, imported transcript, long meeting, summary draft, and meeting deletion cleanup.

## Execution Status

Completed in this iteration:

- Backend transcript creation now supports server-assigned `seq` when the client omits `seq` or sends a non-positive value.
- Existing positive client-provided `seq` remains compatible.
- Frontend manual, realtime, and imported transcript creation no longer depends on loaded transcript length for `seq`.
- Summary UI now marks generated content as a review draft that needs human confirmation.
- Temporary recording UI now states that audio is not a reliable backup until the user saves it.
- Tests cover optional transcript `seq`, immediate transcript cache update, long import splitting, recording fallback copy, and summary-draft labeling.
- Dedicated `meeting_audio_asset` storage is now implemented for upload/list/delete.
- The meeting page can save a ready temporary recording to the meeting and still offers local download as a fallback copy.
- Audio asset cache updates immediately after save.
- `meeting_asr_job` storage is now implemented for create/list/retry.
- The meeting page creates a transcription job after saving a recording, shows ASR failure state, and exposes retry.
- Local command ASR is now implemented behind `MEETING_ASR_LOCAL_COMMAND`; it reads the persisted audio asset, executes the command without a shell, parses normalized JSON segments, and inserts transcript segments in one transaction.
- Completed ASR jobs now record `source_seq_start/end`, invalidate transcript/insight/summary caches, show the appended transcript range, and cannot be retried.
- ASR job status changes now publish `meeting:asr_job_updated`; realtime clients upsert job state and refresh transcript/insight/summary outputs when a job completes.
- Local ASR health is now exposed through `GET /api/v13/meetings/asr/status` and shown in meeting settings when the user selects the local model.
- A built-in `scripts/meeting-asr-whisper.mjs` wrapper can normalize OpenAI Whisper CLI JSON output into the backend ASR segment schema.
- If no local ASR command is configured, failures remain visible and manual import remains the fallback.
- Saved meeting recordings and their latest ASR job state are now visible after refresh, with a direct download link for the persisted audio asset.
- Summary items now expose transcript evidence links that jump back to the matching source segment in the transcript feed.
- ASR job creation and retry now return immediately with a running job; local ASR executes in the background and updates clients through realtime events plus active-job polling.
- The meeting page now describes local ASR as post-recording transcription instead of unavailable realtime transcription.
- Local ASR command parsing now supports quoted executable paths and arguments, so Mac paths with spaces can be configured without falling back to shell execution.
- Saved recording history now exposes per-asset download/delete actions and failed-job retry directly from the history row.
- ASR execution now has an explicit runner boundary, active-status guarded completion/failure transitions, and startup stale-job recovery for interrupted queued/running jobs.
- External ASR provider adapter is now implemented behind `MEETING_ASR_EXTERNAL_ENDPOINT`; it posts persisted meeting audio as multipart form-data, supports optional bearer auth through `MEETING_ASR_EXTERNAL_API_KEY`, parses normalized segment JSON, inserts transcript segments with source `external`, and reports provider health through `GET /api/v13/meetings/asr/status`.
- Saved-recording transcription now follows the selected provider: `external` meetings create external ASR jobs, other recording-backed meetings use local ASR.
- Long-meeting summary generation now reads all transcript pages and persists deterministic summary chunks with source seq ranges before writing the final rollup.
- Transcript edit, split, merge, and delete are now available through backend transactions, core mutations, realtime updates, and the transcript feed UI.
- Saved recording history now renders every saved asset, keeps the newest ASR job per asset, and surfaces repeated attempt counts and failure details.
- The recorder UI now states the system-audio boundary: microphone capture is supported, system/meeting-speaker audio capture is not implied.

Deferred to the next implementation slice:

- Provider-specific external ASR runbook and contract examples beyond the generic `.env.example` schema.
- A fully bundled local Whisper runtime/model download flow; the current wrapper expects a local `whisper` command to be installed.
- Actual system-audio capture, meeting bot joins, speaker diarization, and calendar integration.

## Remaining Gap Priority Plan v2

This section is the next execution baseline. The rule is to harden shared product boundaries before adding new provider-specific behavior.

### P0 Debt-Control Foundation

1. ASR job runner/service boundary
   - Problem: ASR execution currently exists as request-triggered background work. It is usable, but future provider, cancel, retry, and recovery logic should not keep accumulating in HTTP handlers.
   - Product outcome: saving a recording always returns quickly; transcription continues with honest, recoverable job state.
   - Engineering guardrail: keep provider execution behind a small runner/service interface; do not introduce a distributed queue dependency yet.
   - Acceptance: job creation returns `running` or `queued`; runner publishes status transitions; failed jobs keep the audio asset and are retryable.

2. ASR job recovery and stale-running handling
   - Problem: a server restart can leave a long-running job visually stuck if no recovery rule exists.
   - Product outcome: users never see an indefinitely running transcription after restart.
   - Engineering guardrail: add a startup/runner recovery pass that marks stale `running` jobs as failed with a retryable reason; avoid hidden in-memory state as source of truth.
   - Acceptance: stale jobs become failed/retryable; active jobs still update normally.

3. Local Whisper configuration guide
   - Problem: the wrapper works only when the local `whisper` CLI is installed and configured correctly.
   - Product outcome: users can understand whether local transcription is ready and how to fix it.
   - Engineering guardrail: do not bundle large model downloads or add model/package managers in this slice.
   - Acceptance: UI/doc shows command health, expected env vars, model/language settings, and copy-ready local smoke test.

Landed from this foundation slice:

- Runner boundary and active-status guarded completion/failure transitions.
- Startup stale-job recovery for interrupted queued/running jobs.
- Local ASR health surface and `.env.example` entries for command, model, language, and timeout.

### P1 Workflow Completion

4. Chunked summary generation for long meetings
   - Problem: long meetings need partial source ranges and digest rollups instead of one coarse summary pass.
   - Product outcome: summary remains useful for long transcripts and keeps evidence ranges.
   - Engineering guardrail: use deterministic transcript windows first; do not invent a model orchestration layer.
   - Acceptance: summaries record source seq ranges per chunk and produce a final rollup.
   - Status: landed for deterministic chunk storage and final rollup indexing; model-orchestrated multi-pass summarization remains follow-up.

5. Transcript edit, split, merge, and delete
   - Problem: ASR output needs human correction before the summary becomes trustworthy.
   - Product outcome: users can repair transcript text without losing source ordering.
   - Engineering guardrail: preserve stable `seq` where possible; avoid broad reindexing or destructive rewrites.
   - Acceptance: edit/split/merge/delete are reflected after refresh and summary evidence still points to valid segments.
   - Status: landed with transactional backend APIs, frontend cache updates, realtime segment updated/deleted events, and transcript-feed controls.

6. Full recording and job history management
   - Problem: the current history row covers download/delete/retry, but dense history, multiple jobs per asset, and expanded failure diagnostics are still thin.
   - Product outcome: repeated attempts and multiple recordings remain understandable.
   - Engineering guardrail: build on existing asset/job APIs; avoid a separate attachment subsystem.
   - Acceptance: users can see all assets, latest job state, previous failed attempts, and failure details.
   - Status: landed for all saved assets, newest job state, attempt counts, failure details, download/delete, and failed-job retry; expandable per-job timelines remain follow-up.

### P2 Platform Expansion

7. External ASR provider adapter
   - Problem: enterprises may already have transcription providers.
   - Product outcome: a configured external provider can create normalized transcript segments like the local provider.
   - Engineering guardrail: API keys stay in environment variables; no UI token storage in this slice.
   - Acceptance: one HTTP provider adapter path exists with timeout, error, and normalized segment handling.
   - Status: backend adapter, health status, timeout, bearer auth, normalized segment insertion, and frontend saved-recording job selection are landed; provider-specific runbook remains follow-up.

8. System audio and meeting-room input expansion
   - Problem: browser microphone capture is enough for physical meeting rooms but not full online-meeting system audio.
   - Product outcome: the product clearly distinguishes supported microphone recording from unsupported system-audio capture.
   - Engineering guardrail: implement capability detection and fallback guidance first; virtual-device capture and meeting bots are separate projects.
   - Acceptance: microphone recording remains usable and the UI states that system/meeting-speaker audio is not captured.
   - Status: fallback guidance is landed; actual system-audio capture remains a platform follow-up.

9. Speaker diarization, translation, meeting bot, calendar, retention, and audit
   - Problem: these are platform features that depend on stable job, asset, and transcript-edit boundaries.
   - Product outcome: planned but not allowed to contaminate P0/P1 implementation.
   - Engineering guardrail: no placeholder UI that implies availability before backend behavior exists.
   - Status: not landed; keep as platform follow-up after transcript editing and provider boundaries stabilize.

## Product And Engineering Team Plan

- Product owner: maintain this document, enforce P0/P1/P2 boundaries, and decide whether a proposed shortcut creates unacceptable debt.
- Architecture owner: design the ASR runner/service boundary and stale-job recovery rule before additional providers are added.
- Backend owner: implement runner/service, recovery, cancellation semantics, chunked summary storage, and provider adapters in that order.
- Frontend/UX owner: implement Whisper configuration guidance, recoverable job state messaging, transcript editing, and expanded history management.
- QA owner: maintain the regression matrix for recording, ASR execution, refresh/restart recovery, long transcript summary, and transcript editing.
- DevEx owner: keep `.env.example`, local Whisper runbook, and smoke-test commands current.

## QA Regression Script

- Microphone unavailable: deny or remove microphone access, start a meeting, try recording, and confirm the page shows an actionable fallback while manual transcript remains usable.
- Temporary recording: record at least three seconds, stop, save the audio file, and confirm the file is non-empty and named with the meeting title/time.
- Configured local ASR: set `MEETING_ASR_LOCAL_COMMAND` to a command that emits `{"segments":[{"text":"..."}]}`, save a recording, and confirm transcript segments are appended with source `local`.
- Whisper wrapper: set `MEETING_ASR_LOCAL_COMMAND=node ../scripts/meeting-asr-whisper.mjs`, install the `whisper` CLI, save a recording, and confirm the ASR job completes.
- Manual transcript: add a manual segment and confirm it appears immediately, survives refresh, and receives a backend `seq`.
- Imported transcript: import more than 50 segments and confirm all segments are preserved.
- End meeting: with at least one transcript segment, end the meeting and confirm summary generation completes.
- Summary draft: open the summary panel and confirm the draft/review indicator is visible.
- Long meeting: create more than 200 transcript segments, refresh, append another segment, and confirm there is no sequence conflict.
