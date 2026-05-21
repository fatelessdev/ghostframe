## 2024-03-24 - React.memo with Markdown Streamdown Component
**Learning:** Extracted static configurations (like arrays and objects) are crucial when wrapping expensive components (like the Markdown Streamdown component) with `React.memo`. When defined inside the functional component, arrays/objects are recreated on every render, invalidating the memoization.
**Action:** Always extract configuration objects, arrays, and functions (that don't depend on component props or state) to the module scope before applying `React.memo`.
