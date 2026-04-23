# Ghostframe Hidden Bug Hunt Prompt

## Goal

Find latent bugs users may not have reported yet, especially those that show up during
real interviews (stress, interruptions, reconnections, long sessions).

## Bug Classes

1. Async race bugs
2. Stale state closure bugs
3. Lost updates due to non-atomic state merges
4. Duplicate updates from retry/reconnect paths
5. Resource leaks (listeners, timers, streams)
6. Silent failure paths without user-visible diagnostics
7. Inconsistent behavior across Tauri frontend/backend boundary

## Scan Heuristics

- Look for async handlers that read state, await, then write stale state.
- Look for `useEffect` without cleanup on long-lived resources.
- Look for assumptions that events arrive in order.
- Look for pending queues without upper bounds.
- Look for optimistic writes without rollback on failure.
- Look for missing timeout/abort handling around provider requests.

## Real Interview Stress Scenarios

Evaluate behavior for:
- interviewer/user talking over each other
- rapid trigger presses
- brief network blips during active stream
- device switch mid-session
- very long answer stream
- app background/foreground transitions

## Output

For each hidden bug:

```yaml
id: HIDDEN-<number>
severity: critical|high|medium|low
title: short title
location: file + function
failure_mode: what goes wrong
when_it_happens: scenario
why_hidden: why typical testing misses it
minimal_fix: smallest robust patch
```

Report only credible bugs with clear reasoning.
