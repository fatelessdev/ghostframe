## 2024-05-27 - Markdown Component Optimization
**Learning:** The Markdown component uses heavy libraries like Streamdown, Shiki, Mermaid, and KaTeX. Passing inline objects and arrays for props like `shikiTheme` and `controls` breaks referential equality, leading to expensive re-renders even when the `children` prop hasn't changed.
**Action:** Always extract static configuration objects and arrays outside of the component. For `shikiTheme`, use `[BundledTheme, BundledTheme]` typing. Wrap the component with `React.memo` to prevent wasteful re-renders.
