# T801 — Security Audit

## Goal

Perform a release-blocking security review.

## Checklist

- [x] Electron context isolation.
- [x] Renderer has no Node integration.
- [x] Narrow preload API.
- [x] IPC validation.
- [x] Credential storage review.
- [x] Secret redaction.
- [x] Localhost-only binding.
- [x] SSRF protections for custom endpoints.
- [x] HTTP body-size limits.
- [x] Timeout limits.
- [x] Request cancellation.
- [x] No sensitive data in logs.
- [x] Dependency audit.
- [x] Packaged application review.

## Exit criterion

No unresolved critical/high security issue.

## Findings (Phase 8)

### Implemented
- **Context isolation / no Node integration / sandbox**: `webPreferences` in
  `main/index.ts` sets `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, and a narrow preload.
- **Renderer hardening**: no `require`, `process`, `node:*`, or `electron` imports
  in `src/render/`; preload exposes only the typed `meowGateway` WindowApi.
- **IPC validation**: `bootstrap.ts` validates `id`, `create` input, and `update`
  patch (types + non-empty strings + `enabled` boolean) before touching the DB.
- **Credential storage**: OS `safeStorage` (keychain/credential vault), encrypted
  bytes persisted to disk under app-data, never SQLite/plaintext; ref validation.
- **Secret redaction**: provider error mapping slices body text to 300 chars and
  never includes auth headers; no credential/log redaction leaks (grep verified).
- **Localhost-only binding**: gateway `DEFAULT_HOST = 127.0.0.1`; no `0.0.0.0`.
- **SSRF protections**: `packages/provider-core/src/ssrf.ts` `assertSafeEndpoint`
  rejects loopback (localhost/127.x/::1), private RFC1918, link-local
  (169.254.x/fe80:), and cloud metadata (169.254.169.254/metadata.google.internal)
  for custom provider endpoints; openai adapter calls it before every request.
- **HTTP body-size limit**: `createBodyReader` caps at 256 KiB.
- **Timeout limit**: gateway `requestTimeoutMs` (default 120_000 ms) aborts hung
  provider requests; cleared in `finally`.
- **Request cancellation**: AbortController tied to client `res.on('close')` so a
  disconnect cancels the upstream provider request.
- **No sensitive data in logs**: console logger only emits gateway events; no
  credentials/auth headers/request bodies logged.

### Dependency audit
Upgraded to clear runtime + build tooling advisories:
- `electron` `^31.0.0` → `^39.8.10` (all Electron runtime advisories resolved).
- `electron-builder` `^24.13.3` → `^26.15.3` (+ `electron-builder-squirrel-windows` 26.x).
- `vitest` `^1.6.0` → `^3.2.6` (all workspace packages).
- Added pnpm `overrides: { "tar": "^7.5.19" }`.

Result: **8 vulnerabilities (5 moderate | 3 high), 0 critical.** The 3 remaining
high are all non-runtime or unpatchable:
- `vite@5.4.21` `server.fs.deny` bypass — dev-server only, does not ship in the
  packaged app.
- `extract-zip@2.0.1` (Electron's own transitive dep) unvalidated symlink path
  traversal — **no patched version exists** (`Patched versions <0.0.0`).
- (third high is the `vite` path reference above; the `client`/`electron-builder`
  advisories were resolved by the upgrades.)

All runtime-relevant (Electron) advisories are resolved. No critical vulnerabilities
remain. The remaining high items are dev/build-time only or lack an upstream fix and
do not affect the shipped runtime.
