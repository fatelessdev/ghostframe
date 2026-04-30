## 2026-04-30 - Memoization of computationally heavy components
**Learning:** The Markdown component (using streamdown/shiki/mermaid) is a very expensive renderer. Because it receives a lot of rapid re-renders during app interactions (even when the text content isn't changing), it creates significant main-thread blockages.
**Action:** Always wrap computationally heavy display components (like Markdown renderers) in `React.memo` to prevent wasteful re-evaluations during unrelated parent updates.
