## 2024-05-24 - Missing ARIA labels on Icon Buttons
**Learning:** Shadcn UI Button component with `size="icon"` is frequently used but lacks an implicit accessible name. Relying on `title` attribute is not sufficient for screen reader accessibility.
**Action:** Add explicit `aria-label` attributes to all `Button size="icon"` usages where the icon itself doesn't provide text context. Mirroring the `title` property is often a good start, but ensure the label describes the action clearly.
