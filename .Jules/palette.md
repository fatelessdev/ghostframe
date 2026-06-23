## 2024-05-23 - Initial observation
**Learning:** This app uses shadcn/ui components extensively. There are many instances of `<Button size="icon">` missing `aria-label` attributes, which violates accessibility guidelines. Some of these buttons only have `title` attributes, which are not sufficient for screen readers.
**Action:** Always verify that `<Button size="icon">` has an explicit `aria-label`, even if a `title` or tool-tip is provided.
