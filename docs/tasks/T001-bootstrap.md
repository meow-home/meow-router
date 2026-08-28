# T001 — Bootstrap

## Goal

Create the initial Electron + React + TypeScript project.

## Requirements

- Electron main process.
- Preload process.
- React renderer.
- Vite.
- TypeScript strict mode.
- package scripts for dev/build/test/typecheck/lint.
- context isolation enabled.
- Node integration disabled in renderer.

## Acceptance criteria

- [ ] `npm install` succeeds.
- [ ] `npm run dev` launches the application.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` executes.
- [ ] renderer cannot access Node APIs directly.
- [ ] source structure follows `docs/ARCHITECTURE.md`.

## Notes for AI agent

Inspect the repository first. If an existing Electron structure is already present, adapt it instead of replacing it.
