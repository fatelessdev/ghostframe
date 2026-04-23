# Ghostframe Reference Parity Prompt

## Goal

Scan every app under `references/` and compare against Ghostframe to:
1. detect missing features
2. identify weaker implementations in existing features
3. import robust ideas without blindly copying architecture

## Method

### Step 1: Inventory Reference Apps

For each `references/<app>` collect:
- stated features (README/docs)
- audio/transcription architecture
- response streaming behavior
- error/retry/reconnect behavior
- observability/telemetry patterns

### Step 2: Build Feature Matrix

Use these categories:

1. Audio Capture Robustness
2. Realtime Transcript Correctness
3. Trigger and Snapshot Safety
4. Prompt Assembly Guardrails
5. Response Streaming Resilience
6. Performance Under Long Sessions
7. Diagnostics and Debuggability

For each category, score:
- Ghostframe: 0-5
- Best reference app: 0-5
- Gap: `missing` | `weaker` | `parity` | `better`

### Step 3: Actionable Adoption

For each `missing` or `weaker` gap:
- name the reference app and exact file/pattern
- explain why it is stronger
- propose adaptation for Ghostframe stack (React/Tauri), not copy-paste
- estimate complexity (`small`, `medium`, `large`)
- estimate interview-time impact (`high`, `medium`, `low`)

### Step 4: Own Research

If web/docs access is available, validate at least 2 robustness practices from official docs
for relevant tech (Tauri, Web Audio/WebSocket, React concurrency/state).
If unavailable, continue with repo-only evidence and state limitation explicitly.

## Output

Produce:

1. `Reference Parity Table`
2. `Top 10 Gaps` ranked by impact/effort
3. `Adopt Now` list (quick wins)
4. `Deep Refactors Later` list

Do not flood output with cosmetic differences. Focus on reliability and correctness.
