## 2024-05-18 - React.memo on Streamdown component
**Learning:** `Streamdown` component configuration props (`shikiTheme`, `controls`) when passed inline fail referential equality, leading to expensive re-renders.
**Action:** Always extract static configuration objects/arrays outside the React component tree to avoid unnecessary reference creation across re-renders.
