## 2026-04-24 - Adding ARIA Labels to Icon Buttons
**Learning:** Found several icon-only buttons (like Settings close button and System Prompt options menu trigger) missing context for screen readers. Using Lucide icons inside simple `<button>` wrappers without text is a common pattern here that needs a11y labels.
**Action:** When adding or reviewing simple icon buttons without visible text labels, explicitly check for and add `aria-label` describing the action to ensure full keyboard and screen reader accessibility.
