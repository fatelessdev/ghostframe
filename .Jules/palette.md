## 2024-05-18 - [Icon-Only Buttons Accessibility]
**Learning:** Found multiple instances of icon-only buttons (like modal close buttons, theme toggles, and dropdown triggers) lacking `aria-label`s, which significantly impacts screen reader accessibility in the app's interactive components.
**Action:** Added `aria-label` to these components and will ensure all future interactive elements containing only icons or visual indicators provide descriptive screen reader labels.
