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

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run build
npm run tauri build
```

## Project structure

- `src/` - React frontend
- `src-tauri/` - Rust + Tauri backend
