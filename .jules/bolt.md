## 2025-02-28 - React.memo with Streamdown
**Learning:** `Streamdown` component is very heavy. Passing inline objects/arrays (like `shikiTheme={["github-light", "github-dark"]}`) to `Streamdown` wrapper components (like `Markdown`) forces re-renders of the heavy parser on every parent state change because referential equality breaks.
**Action:** Always extract static configuration objects/arrays outside the component scope and wrap the `Markdown` component in `React.memo` to prevent wasteful re-renders.
