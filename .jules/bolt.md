## 2024-05-03 - Memoizing the Markdown Component
**Learning:** The Markdown component in `src/components/Markdown/index.tsx` is computationally expensive because it utilizes streamdown, shiki, and mermaid. Unrelated state updates in parent components can trigger significant re-rendering lag if this component isn't memoized.
**Action:** Always wrap the Markdown component (and similarly heavy components using complex parsers) with `React.memo` to shallow compare props and avoid unnecessary render cycles.
