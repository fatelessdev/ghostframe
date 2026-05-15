## 2025-05-15 - Add Missing Accessibility Labels
**Learning:** In Ghostframe, many icon-only buttons (like the AutoSpeechVad voice button, settings header back button, and file attachment remove buttons) lack ARIA labels, rendering them inaccessible to screen readers. Relying solely on `title` is insufficient for accessibility, and sometimes even `title` is missing entirely.
**Action:** Always add explicit `aria-label` attributes to icon-only `<Button>` components to ensure they have an accessible name, especially when they only contain Lucide icons.
