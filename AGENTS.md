# AGENTS.md

## Purpose
- This file guides agentic coding assistants working in `C:\Users\fateless\Documents\pluely`.
- Ghostframe is a desktop AI assistant with a React + TypeScript frontend and a Tauri (Rust) shell.
- Preserve the app's lightweight overlay UX and avoid unnecessary architectural churn.

## Project Snapshot
- Frontend: React 19 + TypeScript + Vite.
- Desktop shell: Tauri v2 (`src-tauri/`).
- Styling: Tailwind CSS utilities (plus shadcn/ui-style component patterns).
- Data/storage patterns: localStorage + SQLite via Tauri plugin SQL.
- Path alias: `@/*` maps to `src/*` (see `tsconfig.json` and `vite.config.ts`).

## Source-Of-Truth Rule Order
- Follow direct user instructions first.
- Then follow this `AGENTS.md`.
- Then follow nearby code conventions in touched files.

## Commands (Build / Lint / Test)

### Install
- `npm install` — install JS dependencies.

### Development
- `npm run dev` — run the web app via Vite.
- `npm run tauri dev` — run desktop app in Tauri dev mode.

### Build
- `npm run build` — runs `tsc && vite build`.
  - This is the default verification command for most changes.
- `npm run tauri build` — build production desktop bundles.
  - Run this when touching native integration, window behavior, shortcuts, permissions, or packaging.

### Preview
- `npm run preview` — preview the built web output.

### Lint status
- No lint script is configured in `package.json`.
- No ESLint/Biome/Prettier config is present in the repository root.
- Do not invent or assume a lint command.

### Test status
- No JS/TS test script is configured in `package.json`.
- No Vitest/Jest/Playwright/Cypress config is present.
- No Rust unit tests were found in `src-tauri` (`#[test]`/`#[tokio::test]` not present).

### Single-test command (important)
- There is currently **no supported single-test command** in this repo.
- If asked to run one test, state clearly that no test framework is configured yet.
- Do not fabricate commands like `npm test -- ...`.

## Verification Guidance For Agents
- Minimum default check for code changes: `npm run build`.
- For Tauri/native changes: run `npm run tauri build` (or at least `npm run tauri dev` when iterating).
- Validate the smallest relevant surface first, then run broader verification when needed.
- If a requested validation is impossible (missing tooling), report the gap explicitly.

## Repository Layout
- `src/` — primary React/TypeScript application code.
- `src/components` — shared UI and primitives.
- `src/pages` — route-level screens and feature surfaces.
- `src/hooks`, `src/contexts`, `src/lib`, `src/config`, `src/types` — app logic/state/helpers/types.
- `src-tauri/` — Rust code, Tauri commands, window/native behavior, packaging config.

## Code Style: Imports
- Prefer `@/` alias for imports from `src/*`.
- Use relative imports for very local sibling files where that is already the pattern.
- Keep import groups readable: external packages, then internal alias imports, then local relative imports.
- Keep imports reasonably sorted/alphabetized within groups when practical.

## Code Style: TypeScript / React
- Keep TypeScript strict (repo uses `strict: true`).
- Prefer explicit types over `any`; keep type assertions minimal and local.
- Add return types to exported functions when it improves clarity.
- Use PascalCase for components, interfaces, and types.
- Use camelCase for variables, functions, props, and hooks.
- Constants should be descriptive; use `UPPER_SNAKE_CASE` for true constants.
- Keep components focused; avoid boolean-prop sprawl when composition is cleaner.
- Keep state close to usage unless shared state is clearly justified.
- Follow existing export conventions in touched areas (many route/page files default-export the page).

## Code Style: Formatting
- Match existing formatting in touched files.
- TS/TSX conventions in this repo:
  - double quotes
  - semicolons
  - 2-space indentation
- Rust formatting should remain rustfmt-friendly (default Rust style, 4-space indentation).

## Error Handling And Logging
- Treat Tauri bridge calls (`invoke`, event listeners, window APIs) as failure-prone boundaries.
- Wrap JSON parsing and native bridge interactions with explicit error handling.
- Prefer stable fallback behavior over hard crashes for recoverable failures.
- Use `console.warn` for recoverable/degraded paths.
- Use `console.error` for unexpected failures requiring attention.
- Avoid noisy debug logging in committed code.

## Tauri / Native Safety Rules
- Be careful with:
  - window visibility/focus behavior
  - global shortcuts
  - screenshot and audio capture flows
  - permissions and platform-specific branches
- Keep platform-specific logic isolated and easy to audit.
- Validate payloads crossing web/native boundaries when user-controlled.

## UI/UX Expectations
- Preserve the lightweight overlay feel (fast, responsive, unobtrusive).
- Avoid heavy abstractions or unnecessary dependencies.
- Keep controls discoverable and stateful behavior clear.
- Match existing Tailwind-driven visual language.

## Change Strategy
- Read nearby code before editing.
- Make minimal, targeted changes.
- Avoid unrelated refactors.
- Reuse existing utilities/patterns before creating new abstractions.
- Document assumptions briefly when behavior is ambiguous.

## Cursor/Copilot Rules Status
- Checked `.cursor/rules/`: not present.
- Checked `.cursorrules`: not present.
- Checked `.github/copilot-instructions.md`: not present.
- If any of these files are added later, treat them as additional repo instructions and update this file.

## Change Hygiene For Agents
- Keep diffs scoped to the requested task.
- Avoid renames/moves unless they are required to complete the request.
- Do not change build tooling, CI, or package versions unless explicitly asked.
- Preserve existing behavior outside the target area.
- Reuse existing utilities before adding new helpers.

## Git Safety Expectations
- **Identity:** ALWAYS set your local git identity to `Aditya` and `dashing4149@gmail.com` before committing (`git config user.name "Aditya" && git config user.email "dashing4149@gmail.com"`).
- Do not create commits unless the user explicitly requests a commit.
- Do not push branches unless the user explicitly requests a push.
- Avoid destructive git operations (force push, hard reset) unless explicitly requested.
- Keep commit messages concise and purpose-oriented when commits are requested.

## When Tooling Is Missing
- If asked to run lint/tests, report accurately when tooling is not configured.
- Use available verification (`npm run build`, plus Tauri build when relevant).
- Do not claim “all tests pass” or “lint is clean” when no such tools exist.
- If helpful, suggest adding test/lint tooling only when the user asks for it.

## Final Checklist For Agents
- Confirm scope and touched files match the request.
- Ensure code style matches local conventions.
- Run the best available verification command(s).
- Report verification results and tooling gaps accurately.
- Do not claim lint/test success when lint/tests are not configured.
