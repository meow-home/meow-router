# Phase 0 — Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the runnable Electron + React + TypeScript monorepo shell (T001) with strict mode, context isolation, and a working dev/build/test/typecheck/lint loop.

**Architecture:** A pnpm workspace monorepo with a single Electron app (`apps/desktop`) and the `provider-core` shared package placeholder. Main, preload, and render are built by `electron-vite`; main owns privileged services; render is an isolated React app with no Node access.

**Tech Stack:** pnpm workspaces, electron-vite, Electron, React, TypeScript strict, Vitest, ESLint, Electron Builder (packaging), pino (main-process logging).

## Global Constraints

- TypeScript `strict: true`.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer must not access Node APIs directly (no `electron`/`node:` imports in `src/render`).
- Local gateway binds to `127.0.0.1` by default, never `0.0.0.0` (Phase 0: only enforce the *rule*, gateway server is Phase 3).
- Do not hard-code provider secrets.
- Source structure follows `docs/ARCHITECTURE.md` section 3.
- Electron main/preload/render responsibilities separated.
- No credentials in logs by default.
- pnpm is the package manager (install globally via `npm i -g pnpm` first).
- Node is v20.19.0 (do not assume pnpm via corepack; it fails under this Node).

---

### Task 1: Bootstrap the monorepo toolchain

**Files:**
- Create: `package.json` (root, workspace)
- Create: `pnpm-workspace.yaml`
- Create: `.npmrc`
- Create: `.gitignore` (extend existing)
- Modify: `README.md` (add dev instructions) — optional, deferred

**Interfaces:**
- Produces: workspace-aware `pnpm install`, root scripts for `dev`/`build`/`test`/`typecheck`/`lint`.

- [ ] **Step 1: Install pnpm globally**

Run: `npm install -g pnpm`
Expected: `pnpm --version` prints a version (e.g. `9.x`).

- [ ] **Step 2: Write root `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Write root `.npmrc`**

```
shamefully-hoist=false
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] **Step 4: Write root `package.json`**

```json
{
  "name": "meow-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.0.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "pnpm --filter @meow-gateway/desktop dev",
    "build": "pnpm --filter @meow-gateway/desktop build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "package": "pnpm --filter @meow-gateway/desktop package"
  }
}
```

- [ ] **Step 5: Extend `.gitignore`**

Append if absent:
```
.pnpm-store/
*.tsbuildinfo
corepack/
```
(The existing `.gitignore` already ignores `node_modules/`, `dist/`, `out/`, `release/`, `*.log`, `*.db*`.)

- [ ] **Step 6: Verify workspace resolves**

Run: `pnpm install`
Expected: succeeds; creates `node_modules/` and `pnpm-lock.yaml`. (It may emit warnings about empty workspace — that is fine until apps/packages are added.)

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml .npmrc package.json .gitignore
git commit -m "chore: bootstrap pnpm monorepo workspace"
```

---

### Task 2: Scaffold the Electron app workspace

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/tsconfig.node.json`
- Create: `apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/render/index.html`
- Create: `apps/desktop/src/render/src/main.tsx`
- Create: `apps/desktop/src/render/src/App.tsx`
- Create: `apps/desktop/src/render/src/env.d.ts`
- Create: `apps/desktop/src/shared/ipc.ts`
- Create: `apps/desktop/.gitignore` (or rely on root)

**Interfaces:**
- Produces: a runnable Electron app where render shows a React page, preload exposes a typed minimal API, and main creates a secure window.

- [ ] **Step 1: Write `apps/desktop/package.json`**

```json
{
  "name": "@meow-gateway/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint .",
    "package": "electron-builder"
  },
  "dependencies": {
    "pino": "^9.0.0",
    "electron-store": "^8.2.0"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-vite": "^2.3.0",
    "electron-builder": "^24.13.3",
    "vite": "^5.3.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0",
    "@vitejs/plugin-react": "^4.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/node": "^20.14.0",
    "eslint": "^9.5.0",
    "typescript-eslint": "^8.0.0"
  }
}
```

- [ ] **Step 2: Write `apps/desktop/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": { "@renderer/*": ["src/render/src/*"], "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/render/src/**/*"]
}
```

- [ ] **Step 3: Write `apps/desktop/electron.vite.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/render/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
```

- [ ] **Step 4: Write `apps/desktop/src/shared/ipc.ts`**

```ts
// Narrow typed IPC contract shared between preload, main, and renderer.
// Only non-sensitive, schema-validated payloads cross this boundary.

export interface WindowApi {
  ping(): Promise<string>
}

export const IPC_CHANNELS = {
  ping: 'app:ping'
} as const

export type PingPayload = { from: string }
export type PingResult = { pong: string; echo: string }
```

- [ ] **Step 5: Write `apps/desktop/src/main/index.ts`**

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS, type PingPayload, type PingResult } from '../shared/ipc'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../render/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  ipcMain.handle(IPC_CHANNELS.ping, (_e, payload: PingPayload): PingResult => {
    return { pong: 'pong', echo: payload.from }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 6: Write `apps/desktop/src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type PingPayload, type PingResult, type WindowApi } from '../shared/ipc'

const api: WindowApi = {
  ping: async () => {
    const payload: PingPayload = { from: 'preload' }
    return ipcRenderer.invoke(IPC_CHANNELS.ping, payload) as Promise<PingResult>
  }
}

contextBridge.exposeInMainWorld('meowGateway', api)
```

- [ ] **Step 7: Write `apps/desktop/src/render/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>Meow Gateway</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Write `apps/desktop/src/render/src/env.d.ts`**

```ts
/// <reference types="vite/client" />

import type { WindowApi } from '@shared/ipc'

declare global {
  interface Window {
    meowGateway: WindowApi
  }
}

export {}
```

- [ ] **Step 9: Write `apps/desktop/src/render/src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 10: Write `apps/desktop/src/render/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'

export default function App(): JSX.Element {
  const [status, setStatus] = useState<string>('…')

  useEffect(() => {
    window.meowGateway?.ping().then((r) => setStatus(r.pong))
  }, [])

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', color: '#e6e6e6', background: '#0b0e14', minHeight: '100vh' }}>
      <h1>Meow Gateway</h1>
      <p>Renderer ↔ Main IPC: <strong>{status}</strong></p>
    </div>
  )
}
```

- [ ] **Step 11: Run typecheck**

Run: `pnpm --filter @meow-gateway/desktop typecheck`
Expected: passes (no type errors).

- [ ] **Step 12: Commit**

```bash
git add apps/desktop
git commit -m "feat: scaffold Electron + React + TS app shell"
```

---

### Task 3: Verify dev launch & renderer isolation

**Files:**
- Test: `apps/desktop/src/render/src/App.test.tsx`
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/src/render/src/test/setup.ts` (optional DOM setup)

**Interfaces:**
- Consumes: `App` from Task 2.
- Produces: a passing `npm test` (Vitest) that verifies render compiles and pings the IPC contract via the mocked bridge.

- [ ] **Step 1: Write `apps/desktop/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/render/src/test/setup.ts']
  }
})
```

- [ ] **Step 2: Write `apps/desktop/src/render/src/test/setup.ts`**

```ts
import { vi } from 'vitest'

Object.defineProperty(window, 'meowGateway', {
  value: {
    ping: vi.fn().mockResolvedValue({ pong: 'pong', echo: '' })
  },
  configurable: true
})
```

- [ ] **Step 3: Write `apps/desktop/src/render/src/App.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders and pings the preload bridge', async () => {
    render(<App />)
    const el = await screen.findByText('pong')
    expect(el).toBeTruthy()
  })
})
```

- [ ] **Step 4: Add test deps to `apps/desktop/package.json`**

Add to `devDependencies`:
```
"@testing-library/react": "^16.0.0",
"@testing-library/user-event": "^14.5.0",
"jsdom": "^24.1.0"
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @meow-gateway/desktop test`
Expected: PASS.

- [ ] **Step 6: Verify dev launches (manual/optional because no display in CI)**

Run: `pnpm --filter @meow-gateway/desktop dev`
Expected: Electron window opens, shows "Meow Gateway" and "pong" from IPC. If running headless, note this is a manual check.

- [ ] **Step 7: Confirm renderer has no Node access**

Inspect source: `src/render` must not import `electron`/`node:`. Confirm `nodeIntegration: false` and `sandbox: true` in main window config. A renderer test asserting `typeof process === 'undefined'` in jsdom is unreliable; rely on the main-process config + no render imports of `node:`.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop
git commit -m "test: add App render + IPC bridge test"
```

---

### Task 4: Lint + provider-core placeholder + docs

**Files:**
- Create: `apps/desktop/eslint.config.js`
- Create: `packages/provider-core/package.json`
- Create: `packages/provider-core/tsconfig.json`
- Create: `packages/provider-core/tsconfig.build.json` (optional)
- Create: `packages/provider-core/src/types.ts`
- Update: `docs/ARCHITECTURE.md` (note actual layout) — optional
- Update: `README.md` (add dev instructions)

**Interfaces:**
- Produces: ESLint that runs across the workspace; a `@meow-gateway/provider-core` package with a stubbed `ProviderAdapter` interface to be fleshed out in Phase 2.

- [ ] **Step 1: Write `apps/desktop/eslint.config.js`**

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
)
```

- [ ] **Step 2: Add lint script to `apps/desktop/package.json`**

Ensure `lint` script exists: `"lint": "eslint ."`.

- [ ] **Step 3: Write `packages/provider-core/package.json`**

```json
{
  "name": "@meow-gateway/provider-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/types.ts",
  "types": "./src/types.ts",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^1.6.0",
    "eslint": "^9.5.0",
    "typescript-eslint": "^8.0.0"
  }
}
```

- [ ] **Step 4: Write `packages/provider-core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 5: Write `packages/provider-core/src/types.ts`**

```ts
// Provider-neutral types. Provider adapters implement ProviderAdapter;
// this package is the only shared contract across provider packages.

export interface ProviderContext {
  credentialRef: string
  baseUrl?: string
  signal: AbortSignal
  requestId: string
}

export interface ModelInfo {
  id: string
  providerModelId: string
  displayName: string
  contextWindow?: number
  inputPrice?: number
  outputPrice?: number
  capabilities: ModelCapabilities
}

export interface ModelCapabilities {
  streaming: boolean
  tools: boolean
  vision: boolean
  reasoning: boolean
  structuredOutput: boolean
}

export interface CredentialCheckResult {
  ok: boolean
  message: string
}

export interface NormalizedChatRequest {
  model: string
  messages: NormalizedMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number
  stream?: boolean
  tools?: unknown[]
  toolChoice?: unknown
  responseFormat?: unknown
}

export interface NormalizedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
  toolCallId?: string
}

export interface NormalizedChatChunk {
  id: string
  kind: 'content_delta' | 'tool_call_delta' | 'finish'
  delta?: string
  toolCallIndex?: number
  finishReason?: string
}

export const ERROR_TYPES = [
  'CLIENT_ERROR',
  'AUTH_ERROR',
  'RATE_LIMIT',
  'PROVIDER_UNAVAILABLE',
  'MODEL_NOT_FOUND',
  'REQUEST_REJECTED',
  'TIMEOUT',
  'STREAM_ERROR',
  'INTERNAL_ERROR'
] as const

export type GatewayErrorType = (typeof ERROR_TYPES)[number]

export interface ProviderAdapter {
  id: string
  getModels(ctx: ProviderContext): Promise<ModelInfo[]>
  validateCredentials(ctx: ProviderContext): Promise<CredentialCheckResult>
  chat(
    ctx: ProviderContext,
    request: NormalizedChatRequest
  ): AsyncIterable<NormalizedChatChunk>
}
```

- [ ] **Step 6: Run workspace typecheck + lint**

Run: `pnpm -r typecheck` and `pnpm -r lint`
Expected: both pass.

- [ ] **Step 7: Update README (brief dev instructions)**

Append a short section:
```markdown
## Development

Prerequisites: Node 20+, pnpm (install with `npm i -g pnpm`).

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
```
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/eslint.config.js packages/provider-core README.md
git commit -m "feat: add eslint + provider-core placeholder + dev docs"
```

---

### Task 5: Final validation (T001 acceptance criteria)

**Files:** none new (verification only)

**Interfaces:** Consumes the whole Phase 0 deliverables.

- [ ] **Step 1: Run `pnpm install`**

Run: `pnpm install`
Expected: succeeds.

- [ ] **Step 2: Run `pnpm dev`**

Run: `pnpm dev`
Expected: app launches (manual; on a desktop). If headless, note it and rely on build + typecheck.

- [ ] **Step 3: Run `pnpm typecheck`**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Run `pnpm test`**

Run: `pnpm test`
Expected: executes (App test passes).

- [ ] **Step 5: Confirm renderer cannot access Node APIs**

Check: `src/render` has no `electron`/`node:` imports; main window uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

- [ ] **Step 6: Confirm source structure follows ARCHITECTURE**

Check: `apps/desktop/src/main`, `preload`, `render`, `shared` exist; `packages/provider-core` exists.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: phase 0 bootstrap complete"
```

---

## Self-Review

**Spec coverage (Phase 0 / T001):**
- Monorepo workspace (Task 1) ✅
- pnpm global install (Task 1) ✅
- Electron main + preload + React render (Task 2) ✅
- Vite via electron-vite (Task 2) ✅
- TypeScript strict (all tsconfigs) ✅
- dev/build/test/typecheck/lint scripts (Tasks 1-3) ✅
- context isolation + no node integration (Tasks 2, 5) ✅
- source structure per ARCHITECTURE (Task 4-5) ✅
- T001 acceptance criteria (Task 5) ✅

**Placeholder scan:** All steps have concrete code/config. No TBD/TODO.

**Type consistency:** `WindowApi`, `PingPayload`, `PingResult`, `ProviderAdapter`, and normalized types are defined once and referenced consistently. `env.d.ts` uses the `@shared/ipc` alias (resolved via `tsconfig.json` `paths` and the Vite alias in `electron.vite.config.ts`). ✅

**Note on corepack:** pnpm is installed via `npm i -g pnpm` because corepack's bundled download fails under Node v20.19.0 (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`). The plan avoids relying on corepack.
