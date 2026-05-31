## 2024-05-31 - Static Object Extraction for Markdown

**Learning:** Passing inline arrays (like `["github-light", "github-dark"]`) and objects (`controls={{...}}`) into expensive components like `Markdown` (which wraps `Streamdown`, Shiki, Mermaid, KaTeX) breaks referential equality on every re-render. This causes unnecessary, computationally heavy updates.

**Action:** Always extract static configuration objects and arrays out of the component function before applying `React.memo()`. For Shiki themes specifically, type them as mutable tuples (e.g. `[BundledTheme, BundledTheme]`) instead of `as const` to avoid TypeScript assignment errors.
