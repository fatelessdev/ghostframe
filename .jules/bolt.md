## 2024-05-14 - Wrap Expensive Component Renderings with React.memo
**Learning:** `ResponseView` component doesn't memoize its output, meaning that the child `Markdown` component might re-render unnecessarily when `OverlayPanel` states change that shouldn't affect the response layout or content.
**Action:** Wrap parent components like `ResponseView` in `React.memo` as instructed by the repository memory: "Performance pattern: Wrap parent view components (like ResponseView) that render heavy child components (like Markdown) with React.memo."
