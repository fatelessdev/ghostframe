## 2025-06-18 - [Aria labels for Icon-only buttons]
**Learning:** Found multiple instances where the `aria-label` attribute is missing from icon-only buttons (`size="icon"`). Often the `title` attribute is present, but missing `aria-label`.
**Action:** Adding explicit `aria-label` attribute using the string present in the `title` attribute for screen readers. Added a `Slider` `aria-label` to some `Sliders` without it.
