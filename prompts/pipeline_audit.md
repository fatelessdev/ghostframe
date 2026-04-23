# Ghostframe Pipeline Audit Prompt

## Goal

Audit correctness and resilience of the full real-time path:

audio capture -> realtime transcription -> interim/pending/final state -> answer trigger
-> snapshot lock -> prompt assembly -> AI dispatch -> streaming response -> final UI.

## Critical Invariants (Must Hold)

### Transcript State Invariants

1. `final` text must never be downgraded or overwritten by later `interim` text.
2. Pending segment replacement must match speaker identity and recency window.
3. Dual stream (`interviewer` and `user`) updates must preserve source attribution.
4. Late events after trigger snapshot must not mutate in-flight request payload.
5. Segment patch logic must be idempotent for duplicate final events.

### Trigger/Snapshot Invariants

1. Trigger commits both sessions before snapshot (or times out with explicit warning).
2. Snapshot is deep-copied, immutable for request lifecycle.
3. Prompt assembly uses locked snapshot, not live mutable transcript state.
4. Optional typed instruction is appended exactly once.

### Streaming Invariants

1. Chunks are ordered and assembled deterministically.
2. RAF flush queue is drained and cleaned on completion, cancel, and unmount.
3. Stream errors produce actionable UI state, not silent failure.
4. Completion writes assistant message exactly once.

## Hunt Checklist

Inspect `src/` and `src-tauri/` for:
- stale closure writes in async handlers
- parallel state writes that use non-functional updates
- missing cleanup for websocket/listeners/timers
- unbounded buffers for transcript segments or stream chunks
- optimistic `pending` transitions that can duplicate text on final commit
- trigger spam (double-fire) without debounce/lock

## Race Conditions To Explicitly Probe

1. Final arrives while pending replacement in progress.
2. Interim arrives after final for same utterance.
3. Trigger pressed while a final event is being merged.
4. Reconnect occurs during commit + snapshot window.
5. Response stream ends while UI flush queue still contains chunks.

## Output Format

Return findings in this schema per issue:

```yaml
id: PIPE-<number>
severity: critical|high|medium|low
area: transcript|trigger|streaming|audio|ui
title: short title
files:
  - path: src/...
    hint: function or hook name
evidence: concrete reasoning from code path
user_impact: interview-time failure scenario
recommended_fix: smallest safe change
confidence: high|medium|low
```

Prioritize reproducible, concrete defects over speculative style critiques.
