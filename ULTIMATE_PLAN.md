# Pluely Improvement Backlog (Living Plan)

## Status Legend
- `Implemented`: shipped in this repo
- `Active`: planned for near-term implementation
- `Deferred`: useful, but intentionally postponed

---

## Phase 1: Feature Porting

### 1) Stealth / Anti-Tracking
- **1.4 Anti-analysis / anti-debugging** - `Deferred`
  - Keep for later native hardening pass (`src-tauri` startup/runtime checks).

### 2) Performance & Latency
- **2.1 Gemini Live real-time audio (TEXT modality)** - `Active`
  - Main latency win: remove separate STT batch step for supported providers.
- **2.2 Speaker diarization (Gemini Live)** - `Active`
  - Important for interviewer vs candidate attribution correctness.
- **2.5 Epoch summarization (long-session context compression)** - `Active`
  - Prevents early interview context from being lost.
- **2.7 Acoustic echo cancellation (AEC)** - `Deferred`
  - Valuable for speaker-only setups; higher implementation effort.

### 3) UI/UX for Low Cognitive Load
- **3.3 Compact overlay modes** - `Implemented`
  - Reduce occlusion while keeping answers readable. Toggle via Ctrl+Shift+C.
- **3.5 Response navigation (prev/next)** - `Implemented`
  - Useful for revisiting earlier answers in long sessions. Navigate via Ctrl+[ and Ctrl+].
- **3.6 Split layout for code responses** - `Implemented`
  - Helpful for coding interviews. Toggle via Ctrl+Shift+\.
- **3.7 Keyboard-driven response scrolling** - `Active`
  - Improves hands-on-keyboard workflow and low-visibility interaction.

### 4) Quality of Life
- **4.1 Profile/preset system with specialized prompts** - `Active`
  - Interview-specific presets remain high impact.
- **4.5 Intelligent transcription filtering** - `Active`
  - Reduce noise from small-talk transcripts before full answer generation.
- **4.6 Multi-monitor window tracking** - `Active`
  - Keep overlay aligned with active monitor/work area.
- **4.8 Local/offline STT pipeline** - `Deferred`
  - Useful privacy/traceability feature; currently lower priority.

---

## Phase 2: Novel Recommendations

- **N1 Gaze-optimized webcam-anchored positioning** - `Active`
- **N2 Teleprompter auto-scroll mode** - `Active`
- **N3 Predictive response generation** - `Deferred`
- **N4 Answer chunking with speaking pace markers** - `Deferred`
- **N5 Time-buying quick actions** - `Active`
- **N6 Latency budget dashboard** - `Deferred`
- **N7 One-handed shortcut layout** - `Deferred`
- **N8 Network pre-flight + provider auto-switch** - `Deferred`
- **N9 Transcription confidence indicator** - `Deferred`
- **N10 Interview prep mode** - `Deferred`

---

## Priority Matrix (Current)

### P0 Critical
- 2.1 Gemini Live real-time audio (`Active`)
- 4.1 Interview profile/preset system (`Active`)

### P1 High
- 2.2 Speaker diarization (`Active`)
- 4.5 Intelligent transcription filtering (`Active`)
- N1 Gaze-optimized positioning (`Active`)
- N5 Time-buying quick actions (`Active`)

### P2 Medium
- 2.5 Epoch summarization (`Active`)
- 3.3 Compact overlay (`Implemented`)
- 3.5 Response navigation (`Implemented`)
- 3.6 Split code layout (`Implemented`)
- 3.7 Keyboard response scrolling (`Active`)
- 4.6 Multi-monitor tracking (`Active`)

### P3 Lower / Deferred
- 1.4 Anti-analysis
- 2.7 AEC
- 4.8 Local/offline STT
- N3, N4, N6, N7, N8, N9, N10

---

## Notes
- This file is intentionally concise and implementation-focused.
- Keep statuses updated as features move from `Active` to `Implemented`.
