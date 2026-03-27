# Ghostframe

Ghostframe is a lightweight desktop AI assistant built with Tauri, React, and TypeScript.

## What it does

- Always-on-top overlay for quick prompts
- Voice input and system audio capture
- Screenshot capture with manual and auto workflows
- Local chat history stored in SQLite
- Global shortcuts, dashboard controls, and custom providers

## Tech stack

- Frontend: React 19 + TypeScript + Vite
- Desktop shell: Tauri v2 (Rust)
- Styling: Tailwind CSS
- Storage: localStorage + SQLite (`@tauri-apps/plugin-sql`)

## Prerequisites

- Node.js 18+
- Rust (stable)
- Tauri system prerequisites: https://v2.tauri.app/start/prerequisites/

## Quick start

```bash
npm install
npm run tauri dev
```

## Commands

- `npm run dev` - run frontend only (Vite)
- `npm run tauri dev` - run full desktop app (frontend + Tauri shell)
- `npm run build` - TypeScript compile and Vite production build
- `npm run tauri build` - desktop production bundles
- `npm run preview` - preview built frontend output

## Lint and tests status

- No lint script is configured in `package.json`.
- No JS/TS test runner is configured in `package.json`.
- No single-test command is currently supported in this repository.

If you need test coverage, add a test runner first (for example Vitest for frontend and/or Rust tests under `src-tauri`).

## Project structure

- `src/` - React frontend
- `src-tauri/` - Rust + Tauri backend

## Agent guidance

If you are using an agentic coding tool in this repo, read `AGENTS.md` first for:

- verified build/lint/test command policy
- style and naming conventions
- Tauri safety constraints and verification expectations
