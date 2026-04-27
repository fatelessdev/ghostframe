## 2024-05-18 - Markdown Component Memoization
**Learning:** The `Markdown` component (`src/components/Markdown/index.tsx`) in this architecture uses heavy computations (`streamdown`, `shiki`, `mermaid`). Parent re-renders can trigger wasteful re-renders of this computationally expensive component if it's not memoized, causing UI jank.
**Action:** Always utilize `React.memo()` for Markdown rendering components and explicitly document the performance reasons using Bolt's 💡/🎯/📊 format.
