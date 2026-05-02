## 2026-05-02 - Memoizing Expensive Components
**Learning:** The `Markdown` component uses `streamdown`, `shiki`, and `mermaid`, making it computationally expensive. By default, it re-rendered whenever parent components updated, leading to unnecessary overhead.
**Action:** Always wrap computationally expensive UI components, especially those handling markdown or syntax highlighting, in `React.memo` to prevent wasteful re-renders during parent updates.
