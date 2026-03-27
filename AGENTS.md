# AGENTS.md

## Purpose
- This file guides agentic coding assistants working in `C:\Users\fateless\Documents\Projects\ghostframe`.
- Ghostframe is a lightweight desktop AI overlay: React + TypeScript frontend with a Tauri v2 Rust shell.
- Prioritize minimal diffs, fast interaction, and the existing overlay UX.

## Startup Expectations For Agents
- Run the agent/session init flow before doing work (`/init` in OpenCode-style environments).
- Read this file first, then follow nearby code patterns in touched files.
- If user instructions conflict with this file, user instructions win.

## Project Snapshot
- Frontend: React 19 + TypeScript + Vite.
- Native shell: Tauri v2 (`src-tauri/`).
- Styling: Tailwind CSS v4 utilities and component patterns.
- Storage: localStorage + SQLite through `@tauri-apps/plugin-sql`.
- Import alias: `@/*` -> `src/*` (`tsconfig.json`, `vite.config.ts`).

## Commands (Install / Dev / Build / Lint / Test)

### Install
- `npm install` - install JavaScript dependencies.

### Development
- `npm run dev` - run frontend only (Vite).
- `npm run tauri dev` - run full desktop app in Tauri dev mode.

### Build
- `npm run build` - TypeScript compile + Vite production build.
  - Default verification command for most frontend or shared changes.
- `npm run tauri build` - production desktop bundles.
  - Run when changing Rust, native permissions, window behavior, shortcuts, capture/audio integration, or packaging.

### Preview
- `npm run preview` - preview built web output.

### Lint Status (important)
- No lint script exists in `package.json`.
- No repo-root ESLint/Biome/Prettier config is present.
- Do not claim lint success and do not invent lint commands.

### Test Status (important)
- No JS/TS test script exists in `package.json`.
- No Vitest/Jest/Playwright/Cypress config found.
- No Rust test modules were found in `src-tauri` (`#[test]` / `#[tokio::test]`).

### Single-Test Command (important)
- There is currently **no supported single-test command** in this repository.
- If asked to run one test, state clearly that a test runner is not configured yet.
- Do not fabricate commands like `npm test -- ...` or fake per-file test invocations.

## Verification Guidance
- Minimum default verification after code edits: `npm run build`.
- For native/Tauri changes, prefer `npm run tauri build` (or `npm run tauri dev` while iterating).
- Verify the smallest relevant surface first, then expand if needed.
- If requested verification is impossible due to missing tooling, report the gap explicitly.

## Repository Layout
- `src/` - React/TypeScript application.
- `src/components` - reusable UI primitives and composite components.
- `src/pages` - route-level pages/features.
- `src/hooks`, `src/contexts`, `src/lib`, `src/config`, `src/types` - logic, state, helpers, config, types.
- `src/routes` - app route composition.
- `src-tauri/` - Rust commands, native integrations, window lifecycle, desktop packaging.

## Code Style: Imports
- Prefer `@/` imports for `src/*` modules.
- Use local relative imports for very close siblings when already standard in that file/area.
- Group imports as: external packages, internal alias imports, local relative imports.
- Keep import lists readable and reasonably sorted within groups.

## Code Style: TypeScript / React
- Keep TypeScript strict; repository uses `strict: true`.
- Respect compiler constraints from `tsconfig.json`: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
- Prefer explicit types over `any`; keep assertions small and local.
- Add exported function return types when they clarify contracts.
- Naming: PascalCase for components/types/interfaces, camelCase for values/functions/hooks, UPPER_SNAKE_CASE for true constants.
- Keep components focused; avoid unnecessary abstraction and boolean-prop sprawl.
- Keep state close to usage unless shared state is clearly justified.
- Follow local export conventions in touched files (many page files default-export route components).

## Code Style: Formatting
- Match existing formatting in touched files.
- TS/TSX conventions used in this repo: double quotes, semicolons, 2-space indentation.
- Keep CSS/Tailwind patterns consistent with existing utility-first style.
- Keep Rust code rustfmt-friendly (standard formatting, 4-space indentation).

## Code Style: Rust / Tauri Commands
- Keep platform-specific logic behind `#[cfg(...)]` gates and avoid mixing platforms in shared branches.
- Follow existing command shape for IPC methods (`#[tauri::command]` + `Result<_, String>` where errors are user-facing).
- Add context when mapping native errors (`map_err(|e| format!("...: {}", e))`).
- Avoid new `unwrap()`/`expect()` in runtime paths unless failure is truly unrecoverable.
- Keep shared runtime state in explicit structs managed via `app.manage(...)`.

## Code Style: CSS / Tailwind
- Prefer utility classes first; add CSS rules in `src/global.css` only for cross-component patterns.
- Reuse existing custom properties (`--overlay-*`, theme tokens) before introducing new ones.
- Preserve readability features (contrast mode, click-through behavior, markdown overflow handling).
- Keep overlay layout responsive for both compact and expanded states.

## Error Handling And Logging
- Treat web/native boundaries (`invoke`, event listeners, window APIs, plugin calls) as failure-prone.
- Validate or guard user-controlled payloads crossing frontend/native boundaries.
- Prefer stable fallback behavior over hard crashes for recoverable failures.
- Use `console.warn` for degraded-but-recoverable states.
- Use `console.error` for unexpected failures requiring attention.
- Avoid noisy debug logs in committed code.

## Tauri / Native Safety Rules
- Be extra careful with window visibility/focus/topmost state, content protection, click-through, and dashboard behavior.
- Be extra careful with global shortcuts, screenshot/audio capture, and platform-specific branches.
- Keep platform-specific code isolated and easy to audit.
- Preserve security/permission assumptions unless the user explicitly asks to change them.

## Data / Storage Guidelines
- Reuse existing storage helpers under `src/lib/storage` before adding new keys or serializers.
- Keep localStorage keys stable unless a migration path is included.
- For SQLite changes via plugin SQL, ensure migrations remain deterministic and forward-only.
- Avoid storing secrets or provider credentials in plaintext logs.

## UI/UX Expectations
- Preserve the lightweight overlay feel: responsive, unobtrusive, and easy to recover from errors.
- Match the existing Tailwind-driven visual language and typography choices.
- Avoid unnecessary dependency additions for small UI behavior changes.
- Keep interactive states clear and keyboard/shortcut flows predictable.

## Change Strategy And Hygiene
- Read nearby code before editing.
- Make minimal, targeted changes tied directly to the request.
- Avoid unrelated refactors, renames, or folder moves unless required.
- Reuse existing utilities before creating new helpers.
- Do not change build tooling, CI settings, or dependency versions unless explicitly requested.
- If the working tree is dirty, do not revert user changes outside your scope.

## Cursor And Copilot Rules
- Checked `.cursor/rules/`: not present.
- Checked `.cursorrules`: not present.
- Checked `.github/copilot-instructions.md`: not present.
- If any of these appear later, treat them as additional instructions and update this file.

## When Tooling Is Missing
- Report missing lint/test infrastructure accurately.
- Use available verification (`npm run build`, plus Tauri build/dev for native work).
- Never claim "all tests pass" or "lint is clean" when no such tooling is configured.
- Suggest adding test/lint tooling only when the user asks for it.

## Final Checklist For Agents
- Confirm scope and touched files match the request.
- Ensure style and conventions match local patterns.
- Run relevant verification commands when code changes are made.
- Report verification results and tooling gaps explicitly.
- Keep final diffs focused and reversible.
