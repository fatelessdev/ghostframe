## 2024-05-30 - Memoizing the Markdown component

**Learning:** `Streamdown` component from `streamdown` package used for Markdown rendering inside Ghostframe is a heavy component. Since it relies on Shiki, Mermaid and KaTeX, it executes computationally expensive code when rendering markdown (especially code blocks, math formulas). If it receives new objects or arrays for its `shikiTheme`, `controls` or `components` props on every render, it will trigger unnecessary wasteful re-renders.

**Action:** Extracted static configurations like `SHIKI_THEME`, `CONTROLS`, and `COMPONENTS` outside of the React component to ensure referential equality. Wrapped the `Markdown` component in `React.memo` so it skips re-rendering when parent state updates without changing its props, reducing UI thread blocking and CPU usage.

## 2024-05-30 - Memoizing ResponseView to avoid nested re-renders

**Learning:** `ResponseView` renders `Markdown`. Without `React.memo` on `ResponseView`, any state change in its parent (`InterviewShell` / `OverlayPanel` such as changing capture state, or updating other parts of the overlay that share context) would cause `ResponseView` to re-render, thus passing new props to `Markdown` or re-evaluating the view needlessly.

**Action:** Applied `React.memo` to `ResponseView` so that unless `responseText`, `density`, or `layoutMode` change, it will bypass re-rendering entirely, shielding the expensive `Markdown` component and improving the responsivness of the rest of the shell.
