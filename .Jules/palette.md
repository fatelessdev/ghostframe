## 2025-02-28 - Missing ARIA Labels on Navigation Elements
**Learning:** Found that a standalone generic icon-only button like `XIcon` was missing an `aria-label` for screen readers. Standard layout controls, especially in sidebars and modals, need explicit descriptions.
**Action:** Always check icon-only buttons for accessibility labels, particularly in global navigation components like settings headers or modal dialogs.
