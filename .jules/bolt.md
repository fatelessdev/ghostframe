## 2024-11-20 - Memoization of Dynamic Sub-trees
**Learning:** `App` re-renders frequently due to active system audio state, capturing updates, and quick prompt keystrokes, which wastefully re-renders computationally expensive child sub-trees like `ResponseView` (which parses and highlights Markdown).
**Action:** Always wrap `ResponseView` and large list components like `TranscriptsView` in `React.memo` to shield them from parent re-renders. Ensure parent passes stable props to these components.
