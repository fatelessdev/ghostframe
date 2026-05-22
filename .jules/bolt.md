## 2024-05-22 - Static Config Extraction for Streamdown

**Learning:** Extracted configuration objects (`shikiTheme`, `controls`) inside React components trigger unnecessary re-renders when parent state changes. Furthermore, when using multiple themes with Shiki, the variable must be typed strictly as a tuple (e.g., `[BundledTheme, BundledTheme]`) to resolve TypeScript assignment errors during checks, rather than generic arrays.

**Action:** Always extract static configuration objects and arrays outside of React components before applying `React.memo`, and strictly type Shiki theme arrays as tuples.