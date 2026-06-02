## 2024-06-02 - React.memo on Complex Streamdown component
**Learning:** The Markdown component using Streamdown, Shiki, KaTeX, and Mermaid is computationally heavy. Since Streamdown expects configurations like `shikiTheme` and `controls`, passing them inline breaks referential equality, causing wasteful re-renders on parent state changes.
**Action:** Always extract static configuration objects and arrays outside of React components before applying `React.memo` to ensure referential equality across renders, especially for computationally expensive components like Markdown viewers.
