## 2024-05-12 - Markdown Component Re-renders
**Learning:** The `Markdown` component (`src/components/Markdown/index.tsx`) uses expensive libraries (`streamdown`, `shiki`, `mermaid`) but was lacking memoization and passing inline objects/arrays (`shikiTheme`, `controls`) to its children. This caused unnecessary re-renders when parent components updated.
**Action:** Always extract static configuration objects/arrays outside of React components and use `React.memo` for computationally expensive presentation components like Markdown renderers to prevent wasteful re-renders.
