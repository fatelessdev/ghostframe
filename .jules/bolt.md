## 2024-06-22 - Markdown component optimization
**Learning:** The `Markdown` component in `src/components/Markdown/index.tsx` was creating the `shikiTheme` array and `controls` object inline on every render. Because `Streamdown` is computationally expensive, reconstructing props forces unnecessary re-renders. Also, the `Markdown` wrapper component itself lacked memoization.
**Action:** Extract static objects (`shikiTheme` array, `controls`) outside the component to preserve referential equality and use `React.memo` to shield the component from wasteful re-renders.
