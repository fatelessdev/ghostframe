## 2025-03-09 - Markdown Component Memoization
**Learning:** `Streamdown` and `shiki` components within the codebase represent a very expensive subtree that causes main thread blocking if needlessly re-rendered. Static configuration objects (`THEMES`, `CONTROLS`) passed to `Streamdown` must be extracted out of the component render path to prevent referential inequality triggers.
**Action:** Always wrap `Markdown` implementations and their immediate parent views (like `ResponseView`) in `React.memo` and extract constant objects/arrays outside the component declaration.
