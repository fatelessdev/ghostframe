# Unused/Dead Code Inventory (Do Not Remove Yet)

Date: 2026-03-22
Worktree: `feature/interview-coder-overlay-v2`

## Purpose

Track likely unused code discovered during cleanup so we can remove it safely in a later pass.

This file is intentionally inventory-only. No removals are performed as part of this step.

## How this inventory was built

- Searched symbol references across `src/**/*.ts` and `src/**/*.tsx`.
- Marked candidates where definitions exist but no consumer references were found.
- Kept confidence levels explicit because dynamic usage and lazy imports may not appear in static search.

## Candidates

### 1) `src/pages/settings/components/DeleteChats.tsx`

- Symbol: `DeleteChats`
- Evidence: definition exists, no references found in `src`.
- Confidence: High
- Why it might be dead: settings page appears to use an integrated delete flow instead of this standalone component.
- Removal risk: Low to medium (confirm no runtime dynamic import first).

### 2) `src/pages/system-prompts/Create.tsx`

- Symbol: `CreateSystemPrompt`
- Evidence: definition exists, no references found in `src`.
- Confidence: High
- Why it might be dead: system prompts UI appears to use `CreateEditDialog` instead.
- Removal risk: Low to medium.

### 3) `src/hooks/useWindow.ts`

- Symbol: `useWindowFocus`
- Evidence: definition exists, no references found in `src`.
- Confidence: High
- Why it might be dead: no current feature appears to consume focus callbacks via this hook.
- Removal risk: Medium (window-focus behavior can be sensitive if consumed externally later).

### 4) `src/components/ui/chart.tsx`

- Symbols: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle`
- Evidence: only self-references inside `chart.tsx`; no consumers found in `src`.
- Confidence: High
- Why it might be dead: likely generated UI primitive not currently used by app screens.
- Removal risk: Medium (can be intended shared primitive for future pages).

### 5) `src/lib/functions/common.function.ts`

- Symbol: `setByPath`
- Evidence: definition exists, no references found in `src`.
- Confidence: High
- Why it might be dead: `getByPath` is used for parsing paths, but setter utility is not currently consumed.
- Removal risk: Low.

### 6) `src/lib/chat-constants.ts`

- Symbols: `isValidConversationId`, `isValidMessageId`
- Evidence: definitions exist, no references found in `src`.
- Confidence: High
- Why it might be dead: ID generation helpers are used, validators appear unused.
- Removal risk: Low.

## Not marked as dead

- `src/pages/system-prompts/index.tsx` and `CreateEditDialog.tsx` are actively referenced.
- Routing/settings/menu references to system prompts are active.

## Proposed safe removal plan (later pass)

1. Remove one candidate at a time (small diffs).
2. Run `npm run build` after each removal.
3. For Tauri-sensitive hooks/components, do quick manual smoke checks in app flows.
4. If any runtime regression appears, restore that candidate and mark it as "needed".

## Status

- Inventory complete.
- No code removed in this step.
