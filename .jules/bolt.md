## 2024-05-18 - Markdown Component Optimization
**Learning:** The Markdown component in this repository uses `streamdown`, `shiki`, and `mermaid`, which makes it a computationally expensive component. When parent components re-render, if the Markdown component is not memoized, it causes significant, wasteful re-renders.
**Action:** Always utilize memoization (`React.memo`) for the Markdown rendering component in this architecture. Add comments (`// 💡 What: ...`, `// 🎯 Why: ...`, `// 📊 Impact: ...`) when making these codebase-specific performance improvements.
