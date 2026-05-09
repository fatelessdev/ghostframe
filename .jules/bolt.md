## 2024-05-09 - Markdown Component Memoization
**Learning:** The Markdown component in this repository uses `streamdown`, `shiki`, and `mermaid`, making it computationally expensive. Because it is widely used in chat lists, when a parent component updates, it causes the Markdown component to re-render. Since we didn't memoize it, this leads to significant main thread blocking.
**Action:** Always wrap `Markdown` component and other computationally expensive components with `React.memo` to prevent wasteful re-renders. Use `isStreaming` to correctly control when to render the component.
