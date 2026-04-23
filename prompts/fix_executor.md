# Ghostframe Fix Executor Prompt

## Goal

Apply reliability fixes with minimal blast radius, then verify.

## Modes

- `autofix-safe`: low-risk only
- `autofix-aggressive`: low + medium risk

## Risk Policy

### Low Risk (auto-apply)
- functional state updates to avoid stale writes
- missing cleanup returns in hooks
- missing guards/null checks
- adding retry backoff caps and jitter where straightforward
- preventing duplicate trigger invocation with explicit lock

### Medium Risk (apply only in aggressive mode)
- transcript patch/replacement logic changes
- reconnect state machine adjustments
- stream assembler buffering changes

### High Risk (never auto-apply)
- architecture rewrites
- protocol contract changes
- cross-process redesigns

## Patch Rules

1. One issue per patch chunk.
2. Preserve existing behavior except bug fix target.
3. Add concise comments only when logic is non-obvious.
4. Do not reformat unrelated code.

## Verification

After each applied patch set:

1. `npm run build`
2. if `src-tauri` changed: `cargo check` (inside `src-tauri`)

If verification fails:
- rollback that patch set
- mark issue as `needs-human-review`
- include exact failure output in report

## Output

Emit fix ledger:

```yaml
applied:
  - issue_id: PIPE-004
    files: [src/...]
    verification: pass
rolled_back:
  - issue_id: HIDDEN-003
    reason: build failure
needs_human_review:
  - issue_id: PIPE-009
    reason: high-risk architecture interaction
```
