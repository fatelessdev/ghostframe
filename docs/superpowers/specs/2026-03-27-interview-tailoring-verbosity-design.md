# Design: Interview Tailoring Context + Verbosity Toggle (4.2, 4.4)

## Scope
- Clean `ULTIMATE_PLAN.md` by removing obsolete/already-implemented items and keeping an actionable backlog.
- Implement 4.2 by adding interview-tailoring context fields (resume + job description summaries) and injecting them into interview prompt generation.
- Implement 4.4 by adding a floating-bar verbosity mode indicator/toggle and a global shortcut for toggling verbosity.

## Product Constraints
- App usage is interview-only; optimize around the Start-flow (`useSystemAudio`) instead of general chat.
- Keep behavior aligned with existing architecture and styling.
- Keep context injection user-editable and user-disableable, similar to system prompt controls.
- Skip file-upload parsing complexity; users paste summaries manually.

## Goals
1. Personalize interview answers with user-specific context every time Start-flow sends to AI.
2. Make verbosity instantly switchable in the overlay without opening settings.
3. Keep implementation minimal and consistent with existing response/system-prompt pipelines.

## Non-Goals
- Parsing resume/JD files (PDF, DOCX, etc.).
- Refactoring non-interview chat flows.
- Adding new provider-level prompt templating abstractions.

## Chosen Architecture

### 1) System-Audio Prompt Injection (Interview-only)
- Extend `SystemAudioInterviewSettings` with:
  - `tailoringEnabled: boolean`
  - `resumeSummary: string`
  - `jobDescriptionSummary: string`
- Persist in `system-audio-interview.storage.ts` and migrate safely with defaults.
- In `useSystemAudio`, build effective prompt with existing system-prompt path:
  - base prompt remains current (`systemPrompt` when `useSystemPrompt=true`, else `contextContent`)
  - trim summary values before prompt assembly.
  - when `tailoringEnabled=true`:
    - append `[USER_RESUME_SUMMARY] ...` only if `resumeSummary` is non-empty.
    - append `[TARGET_JOB_SUMMARY] ...` only if `jobDescriptionSummary` is non-empty.
    - append one adaptation instruction line only if at least one summary block exists.
  - append no tailoring block when both summaries are empty (or tailoring is disabled).
- Pass final string through existing `fetchAIResponse(... systemPrompt: ...)` path.

Rationale: keeps behavior localized to Start/interview flow while reusing current prompt assembly logic.

### 2) Settings UX for Interview Tailoring
- In `SystemAudioInterviewSettings`, add a new card section (under existing interview settings) with:
  - toggle: enable/disable interview tailoring context
  - `Resume Summary` textarea
  - `Job Description Summary` textarea
  - helper block with a prewritten prompt users can copy and paste into external AI to summarize resume+JD.
  - `Copy Prompt` button using clipboard API with graceful failure warning.

Notes:
- Keep existing "Use global system prompt" behavior unchanged.
- Tailoring section is additive and independent (can be disabled at any time).

### 3) Verbosity Toggle in Floating Bar
- Reuse existing response-length pipeline (`response-settings.storage.ts`, `RESPONSE_LENGTHS`) instead of creating a second verbosity system.
- Display/toggle state table:
  - `short` -> label `Short`
  - `medium` -> label `Verbose`
  - `auto` -> label `Auto` (first toggle click/shortcut normalizes to `short`)
  - unknown stored value -> normalize to `short`
- In top bar, place verbosity chip directly left of Start button as requested.
- Clicking chip toggles by these transitions:
  - `auto` -> `short`
  - `short` -> `medium`
  - `medium` -> `short`
- Persist via existing `updateResponseLength` and reactively read settings via `responseSettingsChanged` event.

### 4) Verbosity Shortcut
- Add new shortcut action id: `toggle_verbosity_mode`.
- Default keys:
  - macOS: `cmd+shift+s`
  - Windows/Linux: `ctrl+shift+s`
- Handle in app-level custom shortcut listener by toggling response length through same function as UI chip.
- No new backend event needed; route through existing `custom-shortcut-triggered` flow.
- Add `toggle_verbosity_mode` to route-level handled custom actions in `useGlobalShortcuts` to avoid unhandled-shortcut warnings.

## ULTIMATE_PLAN Cleanup Acceptance Criteria
- Keep file as active backlog/reference, not historical dump.
- Keep top-level structure (`Phase 1`, `Phase 2`, `Priority Matrix`) but condense verbose source comparisons and narrative text that does not affect implementation.
- Remove duplicate or stale statements that conflict with current repo state (for example, features already implemented in current branch/base branch).
- For retained features, add a compact status tag at line level where practical: `Implemented`, `Active`, or `Deferred`.
- Explicitly mark `4.2 Custom Context Injection` and `4.4 Verbosity Toggle on Input Bar` as `Implemented` after this change.
- Preserve still-open high-value items (for example 2.1, 2.2, 2.5, 3.3, 3.7, 4.1, 4.5, 4.6) as actionable backlog.

## Error Handling
- Resume/JD summary handling:
  - each summary is trimmed.
  - each block is appended independently only when non-empty.
  - no tailoring block is appended when both summaries are empty or tailoring is disabled.
- Clipboard copy failure: `console.warn` and non-crashing UI state.
- Storage parsing: follow existing safe defaults and migration guards.

## Verification Plan
1. `npm run build`
2. `npm run tauri dev`
3. Manual checks:
   - Start-flow request includes tailoring context when enabled.
   - Tailoring block behavior for all cases: resume-only, JD-only, both-filled, both-empty.
   - Disabling tailoring removes appended block.
   - Top bar displays current verbosity label (`Auto`/`Short`/`Verbose`).
   - Toggle button updates response behavior and persists.
   - `Ctrl+Shift+S` / `Cmd+Shift+S` toggles same mode.
   - New shortcut appears in shortcut settings and registers without warning.
   - No `No callback registered for custom shortcut: toggle_verbosity_mode` warning in console.
   - Persistence survives app restart for verbosity mode and tailoring settings.
   - Settings helper prompt copies to clipboard.

## Files Expected To Change
- `ULTIMATE_PLAN.md`
- `src/types/system-audio-interview.ts`
- `src/lib/storage/system-audio-interview.storage.ts`
- `src/pages/settings/components/SystemAudioInterviewSettings.tsx`
- `src/pages/app/components/interview-shell/OverlayTopBar.tsx`
- `src/pages/app/index.tsx`
- `src/config/shortcuts.ts`
- `src/hooks/useSystemAudio.ts`
- `src/hooks/useGlobalShortcuts.ts`
- (optional) `src/lib/response-settings.constants.ts` if wording needs alignment
