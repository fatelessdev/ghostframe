## 2024-05-28 - Markdown Rendering Bottleneck
**Learning:** The `Markdown` component (using streamdown, shiki, mermaid) is computationally expensive. When not memoized, it causes wasteful re-renders during parent component updates, leading to performance bottlenecks and unnecessary UI thread blocking.
**Action:** Always wrap `Markdown` rendering components in `React.memo` to prevent wasteful re-renders when the content (primitive string and boolean props) hasn't changed.
