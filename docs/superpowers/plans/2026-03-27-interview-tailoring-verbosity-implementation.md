# Interview Tailoring + Verbosity Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add interview-only resume/JD tailoring context injection for Start-flow prompts, add floating-bar verbosity mode visibility/toggle with shortcut support, and clean `ULTIMATE_PLAN.md` into an actionable backlog.

**Architecture:** Extend system-audio interview settings with tailoring fields and append them through the existing system-prompt pipeline in `useSystemAudio`. Reuse the existing global response-length storage (`short|medium|auto`) for verbosity, exposing controls in the overlay top bar and custom shortcut handling. Keep scope surgical by limiting behavior changes to Start/interview flow and settings/top-bar UI.

**Tech Stack:** React 19, TypeScript, Tauri v2, localStorage-backed settings, existing shortcut/event bridge.

---

### Task 1: Extend Interview Settings Data Model + Storage

**Files:**
- Modify: `src/types/system-audio-interview.ts`
- Modify: `src/lib/storage/system-audio-interview.storage.ts`

- [ ] **Step 1: Add new settings fields to type**

Add:
- `tailoringEnabled: boolean`
- `resumeSummary: string`
- `jobDescriptionSummary: string`

- [ ] **Step 2: Add defaults and migration-safe parsing**

Update `DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS` and `getSystemAudioInterviewSettings()` parsing to safely hydrate new fields from storage, falling back to defaults.

- [ ] **Step 3: Run build to catch type regressions**

Run: `npm run build`
Expected: Successful TypeScript compile for updated settings shape.

---

### Task 2: Add Interview Tailoring UX in Settings

**Files:**
- Modify: `src/pages/settings/components/SystemAudioInterviewSettings.tsx`

- [ ] **Step 1: Add helper prompt block with copy action**

At the top of tailoring section, render a copyable helper prompt users can paste into external AI to produce resume/JD summaries.

- [ ] **Step 2: Add tailoring controls**

Add UI controls:
- Enable/disable switch for tailoring context
- `Resume Summary` textarea
- `Job Description Summary` textarea

Persist all changes with existing `applySettings()` path.

- [ ] **Step 3: Handle clipboard errors gracefully**

Use `navigator.clipboard.writeText(...)` with try/catch and `console.warn` on failure; do not block UI.

- [ ] **Step 4: Verify style consistency**

Ensure section uses existing card/label/textarea classes and spacing patterns from this component.

---

### Task 3: Inject Tailoring Context Into Start-Flow Prompt Assembly

**Files:**
- Modify: `src/hooks/useSystemAudio.ts`

- [ ] **Step 1: Extend local settings bindings in hook**

Read new settings fields from `settings` state:
- `tailoringEnabled`
- `resumeSummary`
- `jobDescriptionSummary`

- [ ] **Step 2: Append tailoring block through existing system-prompt pipeline**

Update `getEffectiveSystemPrompt()` to:
- Keep current base prompt behavior.
- Trim `resumeSummary` and `jobDescriptionSummary` before checks.
- Append resume block `[USER_RESUME_SUMMARY]` only when trimmed resume summary is non-empty.
- Append JD block `[TARGET_JOB_SUMMARY]` only when trimmed JD summary is non-empty.
- Append one adaptation instruction line only when at least one summary block is appended.
- Append no tailoring block when disabled or both trimmed summaries are empty.
- Pass final composed prompt through the existing `fetchAIResponse(... systemPrompt: ...)` path used by Start-flow.

- [ ] **Step 3: Keep Start-flow behavior only**

Ensure only `useSystemAudio` request path is affected; no changes to general chat completion prompt assembly.

- [ ] **Step 4: Run build verification**

Run: `npm run build`
Expected: No hook/type/import regressions.

---

### Task 4: Add Floating-Bar Verbosity Indicator + Toggle

**Files:**
- Modify: `src/pages/app/components/interview-shell/OverlayTopBar.tsx`
- Modify: `src/pages/app/index.tsx`

- [ ] **Step 1: Add verbosity props to top bar component**

Add props for current verbosity label/state and toggle handler.

- [ ] **Step 2: Render verbosity chip left of Start button**

Show one of `Auto`, `Short`, `Verbose` and keep visual language aligned with existing mode toggle styling.

- [ ] **Step 3: Implement toggle transitions in app page**

Use existing response settings storage pipeline:
- `auto -> short`
- `short -> medium`
- `medium -> short`
- unknown stored value -> normalize to `short`

Persist with existing `updateResponseLength` and sync with `responseSettingsChanged` events.

- [ ] **Step 4: Run build verification**

Run: `npm run build`
Expected: Top-bar props and state handling compile.

---

### Task 5: Add Verbosity Shortcut + Route Handling

**Files:**
- Modify: `src/config/shortcuts.ts`
- Modify: `src/hooks/useGlobalShortcuts.ts`
- Modify: `src/pages/app/index.tsx`

- [ ] **Step 1: Add shortcut action metadata**

Add `toggle_verbosity_mode` with defaults:
- macOS: `cmd+shift+s`
- Windows/Linux: `ctrl+shift+s`

- [ ] **Step 2: Mark action as route-handled**

Add `toggle_verbosity_mode` to `ROUTE_HANDLED_CUSTOM_ACTIONS` so no unhandled warning appears.

- [ ] **Step 3: Handle custom shortcut event in app page**

In existing `custom-shortcut-triggered` listener, route `toggle_verbosity_mode` to the same verbosity toggle function used by top bar.

- [ ] **Step 4: Build verification**

Run: `npm run build`
Expected: Shortcut metadata and event handling compile cleanly.

---

### Task 6: Clean `ULTIMATE_PLAN.md`

**Files:**
- Modify: `ULTIMATE_PLAN.md`

- [ ] **Step 1: Condense analysis-heavy historical sections**

Remove or compress stale/duplicate narrative text that is not actionable while preserving top-level structure (`Phase 1`, `Phase 2`, `Priority Matrix`).

- [ ] **Step 2: Keep active backlog with compact statuses**

Retain high-value open items with status tags (`Implemented`, `Active`, `Deferred`) where useful, explicitly preserving `2.1`, `2.2`, `2.5`, `3.3`, `3.7`, `4.1`, `4.5`, and `4.6` as actionable entries.

- [ ] **Step 3: Mark 4.2 and 4.4 as implemented**

Ensure these two items are clearly marked implemented in cleaned plan.

- [ ] **Step 4: Spot-check readability**

Confirm the file remains understandable as a living implementation backlog.

---

### Task 7: Final Verification + Commit

**Files:**
- Modify: all files above

- [ ] **Step 1: Run required verification commands**

Run:
- `npm run build`
- `npm run tauri dev` (manual shortcut/runtime smoke test)

Expected:
- Build succeeds.
- `Ctrl+Shift+S`/`Cmd+Shift+S` toggles verbosity without warning.

- [ ] **Step 2: Manual behavior checklist**

Validate:
- Tailoring injection works for resume-only, JD-only, both, and disabled states.
- Floating bar shows active verbosity mode.
- Top-bar and shortcut toggles stay in sync.
- Shortcut appears in shortcut settings UI.
- No warning `No callback registered for custom shortcut: toggle_verbosity_mode` appears.
- Persistence survives app restart for both verbosity mode and tailoring settings.
- Settings helper prompt copies successfully.

- [ ] **Step 3: Commit once at end**

Run:
```bash
git add ULTIMATE_PLAN.md src/types/system-audio-interview.ts src/lib/storage/system-audio-interview.storage.ts src/pages/settings/components/SystemAudioInterviewSettings.tsx src/hooks/useSystemAudio.ts src/pages/app/components/interview-shell/OverlayTopBar.tsx src/pages/app/index.tsx src/config/shortcuts.ts src/hooks/useGlobalShortcuts.ts
git commit -m "feat(interview): add tailoring context and overlay verbosity toggle"
```
