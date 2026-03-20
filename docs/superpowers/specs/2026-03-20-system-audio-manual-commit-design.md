# System Audio Interview Mode: Manual Commit + Dual Realtime STT + Screenshot Cache

## Goal

Implement a low-latency interview workflow in System Audio mode (headphones icon) where:

- System audio and mic audio are transcribed in parallel via ElevenLabs realtime STT.
- AI response is sent only when the user presses `Ctrl+Enter` (global shortcut).
- The request includes source-labeled transcript (`Interviewer`/`User`) and screenshot context.
- Screenshot capture adds no send-path latency by using a periodic background cache (2 seconds).
- Existing auto-send and stale/manual-only logic are removed from this mode.

## Scope

### In scope

- System Audio mode only.
- Dual realtime STT sessions (system audio + mic) using ElevenLabs realtime.
- Manual commit/send trigger via global `Ctrl+Enter` shortcut action.
- 2-second periodic screenshot cache during active System Audio capture.
- Manual screenshot support in addition to periodic cached screenshot.
- Rolling transcript bar UI for live visibility.
- Move system-audio settings from in-popover controls to Settings page.
- Remove dead/obsolete system-audio code paths superseded by manual commit architecture.

## Non-negotiable behavioral decisions

- Dual-stream mic capture is mandatory in System Audio interview mode (no runtime toggle).
- Periodic screenshot cache interval is fixed at 2000ms for this feature.
- VAD/silence logic may still gate capture quality, but must never trigger AI send.

### Out of scope

- Changing normal mic VAD/chat behavior outside System Audio mode.
- Replacing non-ElevenLabs STT providers in System Audio mode.
- New model/provider fallback strategy changes.

## Current Gaps

- System Audio flow still auto-commits/sends from realtime events and speech segmentation.
- Realtime STT currently focuses on system audio path; no dedicated parallel mic stream in System Audio mode.
- Screenshot behavior is not optimized for zero send-time latency in System Audio mode.
- System-audio settings are embedded in popover UI instead of centralized Settings page.
- No rolling transcript bar for continuous source-aware transcript validation.

## High-Level Design

### 1) Dual realtime STT pipeline

Two independent ElevenLabs realtime sessions run concurrently while System Audio mode is active:

1. `interviewerConnection` receives system audio chunks from `speech-realtime-chunk` (Tauri speaker capture).
2. `userConnection` receives microphone chunks from a browser mic stream path (frame-level PCM conversion).

Both sessions use manual commit strategy. Transcript events feed source-specific rolling buffers and live display state.

### 2) Manual commit + send

`Ctrl+Enter` triggers a new semantic shortcut action (`answer_trigger`) that is handled only in System Audio mode.

On trigger:

1. Commit both realtime sessions.
2. Await committed transcripts (with bounded timeout and graceful fallback to latest partial text).
3. Merge transcript entries in chronological order with explicit labels:
   - `Interviewer: "..."`
   - `User: "..."`
4. Build AI request from merged labeled transcript.
5. Attach screenshots:
   - latest periodic cached screenshot (single slot)
   - manual screenshots captured by button (bounded queue)
6. Send one AI request and update conversation/messages.

No auto-send occurs on silence, segment-end, or committed transcript events.

#### Send lifecycle and buffer policy

Define explicit state machine:

- `idle` -> `committing` -> `awaiting_finals` -> `assembling` -> `sending` -> (`success` | `fail`) -> `idle`

Rules:

- On `committing`, freeze a `turnCutoffAt` timestamp and prevent concurrent triggers (`answerTriggerInFlightRef`).
- `awaiting_finals` waits for both streams with bounded timeout.
- `assembling` only uses entries `<= turnCutoffAt` for this turn.
- On `success`:
  - clear used transcript entries from active buffers (non-overlapping next turn)
  - clear manual screenshot queue
  - keep periodic cached screenshot slot active
- On `fail`:
  - retain transcript entries and manual screenshots for retry
  - allow next `Ctrl+Enter` to re-attempt with same unsent context plus new entries

### 3) Screenshot capture strategy (2s cache + manual)

- Start periodic screenshot timer when System Audio capture starts.
- Every 2 seconds, capture via `capture_to_base64` into `latestCachedScreenshotRef`.
- In-flight guard prevents overlapping captures.
- Send path only reads cached image (no capture in critical path).
- Manual screenshot button appends screenshots to `manualScreenshotsRef`.
- Send payload includes cached screenshot + manual screenshots, then clears manual queue after successful send.

### 4) UI/UX behavior

System Audio popover becomes operational and lightweight:

- Session status row (live, dual STT, screenshot cache freshness).
- Rolling transcript bar (source-aware, low visual footprint).
- Result section with last committed source-labeled prompt and AI response.
- Controls: stop capture, manual screenshot, new conversation.
- Remove local Enter/Space/Escape recording semantics for this interview mode.

### 5) Settings migration

Create a dedicated Settings-page section for system-audio interview settings:

- Max manual screenshots per send.
- Context behavior and quick actions configuration.
- Advanced recording controls (existing VAD-related capture tuning only).

System Audio popover should no longer host deep configuration panels.

#### Persistence strategy

Use a single object key only:

- `SYSTEM_AUDIO_INTERVIEW_SETTINGS`

Schema:

```json
{
  "maxManualScreenshots": 3,
  "useSystemPrompt": true,
  "contextContent": "",
  "quickActions": ["What should I say?", "Follow-up questions", "Fact-check", "Recap"],
  "captureConfig": {
    "hop_size": 1024,
    "sensitivity_rms": 0.012,
    "peak_threshold": 0.035,
    "silence_chunks": 24,
    "min_speech_chunks": 7,
    "pre_speech_chunks": 8,
    "noise_gate_threshold": 0.003,
    "max_recording_duration_secs": 180
  }
}
```

Migration:

- On first load, hydrate from legacy keys (`system_audio_context`, `system_audio_quick_actions`, `vad_config`) into this object, then write normalized object to `SYSTEM_AUDIO_INTERVIEW_SETTINGS`.
- If both new object and legacy values exist, new object has precedence.

Legacy keys are read-only fallback during migration and are no longer updated after migration.

### VAD applicability in System Audio mode

- VAD/capture tuning may influence chunk quality, speech boundary hints, and noise gating.
- VAD must not invoke `processWithAI` directly and must not auto-trigger send.
- Only global `Ctrl+Enter` (`answer_trigger`) can start AI send in this mode.

## Data Model / State

Add System Audio mode state primitives:

- `interviewerTranscriptBuffer`: source-tagged transcript entries.
- `userTranscriptBuffer`: source-tagged transcript entries.
- `mergedTurnBuffer`: ordered combined entries for next send.
- `latestCachedScreenshotRef`: string | null.
- `manualScreenshotsRef`: string[] (bounded by setting).
- `periodicScreenshotActiveRef`: boolean.
- `answerTriggerInFlightRef`: boolean (prevent duplicate send race).
- `turnCutoffAtRef`: number | null (cutoff timestamp for deterministic turn assembly).

Storage keys (new):

- `SYSTEM_AUDIO_INTERVIEW_SETTINGS` (single source of truth)

### Merge algorithm (deterministic ordering)

Each transcript entry stores:

- `source`: `interviewer` | `user`
- `text`
- `timestampMs` (local `Date.now()` at event receipt)
- `sequence` (monotonic counter)

Merge order for prompt assembly:

1. Include entries with `timestampMs <= turnCutoffAt`.
2. Sort by `timestampMs` ascending.
3. Tie-break by `sequence` ascending.

Late events policy:

- Events received after `turnCutoffAt` belong to next turn, even if audio started earlier.
- Late committed transcript updates for already-sent entries are ignored for prior turn and treated as next-turn context only if newly received.

### Manual screenshot queue policy

- Queue capacity is `maxManualScreenshots`.
- On overflow, keep most recent N manual screenshots and evict oldest entries (FIFO eviction).
- Capture action never blocks due to full queue.
- UI shows non-blocking hint when eviction occurs (e.g., "Oldest manual screenshot replaced").

## Error Handling

- Realtime connection failure on either stream: surface non-blocking warning, retry connection, continue session where possible.
- Commit timeout: proceed with best available buffered transcript and show warning badge.
- Screenshot cache failures: do not block send; send transcript-only if needed.
- Global shortcut conflict/registration failure: reuse existing registration error handling.

## Dead Code Removal Plan

Remove or retire system-audio-only paths replaced by manual commit architecture:

- Auto-send from `speech-segment-ended` and committed transcript events.
- Continuous-mode start/stop/discard keyboard control path in System Audio interview flow.
- Any System Audio screenshot invocation using missing command variants; standardize on `capture_to_base64`.
- In-popover settings sections now moved to Settings page.

## Files to Change

- `src/hooks/useSystemAudio.ts`
- `src/hooks/useGlobalShortcuts.ts`
- `src/config/shortcuts.ts`
- `src-tauri/src/shortcuts.rs`
- `src/pages/app/components/speech/index.tsx`
- `src/pages/app/components/speech/ResultsSection.tsx`
- `src/pages/app/components/speech/Warning.tsx`
- `src/pages/settings/index.tsx`
- `src/pages/settings/components/index.ts`
- `src/pages/settings/components/SystemAudioInterviewSettings.tsx` (new)
- `src/config/constants.ts`
- `src/types/context.type.ts` (if needed for settings exposure)
- `src/pages/app/components/speech/RollingTranscript.tsx` (new)

## Verification Plan

1. Build:
   - `npm run build`
2. Functional checks:
   - Start System Audio mode, confirm dual transcript activity.
   - Confirm no AI send before `Ctrl+Enter`.
   - Press `Ctrl+Enter`, verify labeled transcript + screenshot(s) sent.
   - Confirm periodic screenshot updates every 2s and manual screenshots append.
   - Confirm settings persist and affect behavior.
   - Confirm non-System-Audio flows remain unchanged.

## Acceptance Criteria

- System Audio mode never auto-sends AI requests from silence/VAD events.
- `Ctrl+Enter` globally triggers one send in System Audio mode.
- Request includes source-labeled interviewer/user transcript context.
- Latest periodic cached screenshot is included without send-time capture delay.
- Manual screenshots also included in request payload (bounded queue).
- Rolling transcript bar is visible and useful during capture.
- System audio settings are available in Settings page and removed from popover.
- Two consecutive `Ctrl+Enter` sends produce non-overlapping sent transcript windows.
