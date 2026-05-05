## 2024-05-05 - Markdown Memoization
**Learning:** The Markdown component in this codebase is computationally expensive (Streamdown, Shiki, Mermaid). Without memoization, parent re-renders trigger expensive and wasteful re-evaluations.
**Action:** Always wrap the Markdown component in React.memo to prevent unnecessary re-renders.
