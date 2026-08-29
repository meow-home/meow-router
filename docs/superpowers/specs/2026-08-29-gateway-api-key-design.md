# Design — Gateway API key authentication

Status: Approved (brainstorming)
Date: 2026-08-29
Scope owner: Meow Gateway

## 1. Problem

The gateway has no authentication. `gateway_config.auth_enabled` is persisted
(`main/database/repositories/gatewayConfigRepository.ts`) and surfaced as a
"Require gateway API key" checkbox (`render/src/views/GatewayView.tsx:82`), but
`main/gateway/server.ts` never reads it. There is no key anywhere — not in the
database, not in the credential store, not in code. Toggling the checkbox
changes nothing, so the UI currently tells the user their gateway is protected
when it is not.

`docs/API.md:7-17` already specifies `Authorization: Bearer <local-gateway-key>`
as the intended contract. That section was never implemented.

## 2. Goal

Make the gateway authenticate requests, with a key that exists by default:

- **A key always exists.** Generated on first bootstrap and stored in the OS
  secure credential store, so the Gateway view can show it before the gateway
  has ever been started.
- **Auth is on by default**, including for existing installs. This is a
  deliberate breaking change: clients already pointed at the gateway will get
  401 until they are given the key.
- **The renderer never holds the raw key.** It receives a masked form; copying
  goes through the main process into the clipboard.
- **Rotation takes effect immediately** — no gateway restart needed after
  regenerating a key or toggling the checkbox.

### Non-goals

- Multiple keys, per-client keys, scopes, or expiry.
- Any change to how *provider* credentials work.
- Remote binding. The gateway stays on loopback (`docs/SECURITY.md:43`).

## 3. The key

Format: `mgw_` followed by 32 lowercase hex characters (16 bytes from
`crypto.randomBytes`). The prefix makes the key identifiable in an agent's
config file.

Storage: the existing `CredentialService` under ref `gateway:local-key`. The ref
satisfies `VALID_REF_RE` (`main/credentials/credentialService.ts:16`), so it
needs no change there. The key lives in safeStorage, never in SQLite
(`docs/SECURITY.md:29`).

Generation happens in bootstrap: if `hasCredential('gateway:local-key')` is
false, generate and store. Generation is idempotent — an existing key is never
overwritten, so repeated bootstraps are safe.

## 4. Enabling auth by default

The `gateway_config` DDL declares `auth_enabled INTEGER NOT NULL DEFAULT 0`
(`main/database/migrations.ts:68`). That default is dead code: `save()` always
supplies every column explicitly, so no insert ever falls back to it. **The
table is therefore not rebuilt** — SQLite cannot alter a column default in
place, and it does not need to.

Two changes instead:

1. Migration 6, `gateway_auth_default`: `UPDATE gateway_config SET auth_enabled = 1`.
   This is the breaking step for existing installs.
2. `GatewayConfigRepository.get()`'s no-row fallback (line 27) returns
   `auth_enabled: true`, covering a database that has no config row yet.

## 5. Enforcement

### 5.1 A separate auth module

New `main/gateway/auth.ts` exporting a pure function:

```ts
checkAuth(req: IncomingMessage, policy: AuthPolicy): AuthOutcome
```

Pure and server-free so it is tested directly, without binding a port.

Rules:

- `policy.enabled === false` → pass.
- `GET /health` → always pass. A health check that needs a key stops being a
  health check, and the endpoint discloses only status and version.
- Missing `Authorization`, a non-`Bearer` scheme, or a mismatched key → 401.
- Comparison uses `crypto.timingSafeEqual` on equal-length buffers, not `===`,
  so a wrong key cannot be narrowed down by timing.

The 401 body goes through the existing `toGatewayErrorBody` taxonomy. It never
echoes the expected key, and the `Authorization` header is never logged
(`docs/SECURITY.md:71`).

### 5.2 Wiring into the server

`GatewayDependencies` gains:

```ts
getAuthPolicy?(): Promise<{ enabled: boolean; key: string | null }>
```

**Optional on purpose.** When absent the gateway treats auth as disabled, so the
27 existing tests in `server.test.ts` keep passing untouched and the change stays
reviewable. Bootstrap always supplies it, so "optional" describes the test seam,
never the shipped application.

The check runs in `handle()` immediately after `isAllowedHost`
(`main/gateway/server.ts:64`), before any routing.

### 5.3 Policy cache

`createAuthPolicyCache(configRepo, credentials)` in the main process holds the
resolved policy in memory and exposes `invalidate()`, called when the config is
saved and when the key is regenerated.

Without the cache every request — including every streaming chat completion —
would decrypt the credential store. With it, rotation still takes effect at once,
because the code path that changes the key is the same one that invalidates.

## 6. IPC and UI

Three new channels:

| Channel | Returns | Notes |
|---|---|---|
| `gateway:get-key-info` | `{ masked: string; present: boolean }` | Masked form only |
| `gateway:copy-key` | `void` | Main writes the raw key to the clipboard |
| `gateway:regenerate-key` | `{ masked: string }` | Generates, invalidates the cache |

`WindowApi` gains `gatewayGetKeyInfo()`, `gatewayCopyKey()`,
`gatewayRegenerateKey()`.

The masked form is `mgw_` + 11 bullet characters + the final 4 hex characters,
computed **in the main process**. The bullet count is fixed at 11 and does not
match the 28 hidden characters — the mask must not leak the key's length. The raw key never crosses the preload bridge,
so it cannot appear in renderer state or devtools (`docs/SECURITY.md:95`).

`GatewayView` gains a "Gateway API key" field showing the masked key in the mono
face, with Copy and Regenerate buttons. Regenerate goes through the existing
`ConfirmDialog` — it invalidates every client still holding the old key. The
"Require gateway API key" checkbox becomes functional.

## 7. Testing

- `auth.test.ts` — missing header; wrong scheme; wrong key; correct key; policy
  disabled; `/health` passing in every case.
- `server.test.ts` — 401 with auth on and no key; 200 with the correct key; a
  streaming completion succeeding with a key.
- `gatewayConfigRepository.test.ts` — the no-row fallback now returns
  `auth_enabled: true`.
- Migration test — a row with `auth_enabled = 0` reads back as `1` after
  migrating.
- Key generation — matches `/^mgw_[0-9a-f]{32}$/`; a second bootstrap does not
  overwrite an existing key.
- Masking — the output exposes at most 4 characters of the real key.

No test may write a key into a log, a snapshot, or a fixture.

## 8. Documentation

- `docs/API.md:9` says authentication is optional. It is now on by default;
  rewrite the section around the `Authorization: Bearer` header and the 401.
- `docs/SECURITY.md` — record where the gateway key lives and state that the
  renderer only ever sees the masked form.
- `README.md` — how to find the key and hand it to a coding agent.

## 9. Risks

- **Existing clients break on upgrade.** This is the accepted cost of enabling
  auth by default; migration 6 makes it unconditional. Users must copy the key
  into their agent config.
- **A lost clipboard path leaves the key unreachable.** Regenerate is the
  recovery route, which is why it ships in the same slice rather than later.
- **safeStorage can be unavailable** on some Linux desktops. The credential
  service already maps store failures to safe errors. The gateway then **fails
  closed**: with `auth_enabled` true and no resolvable key, every request is
  rejected with 401 and the Gateway view reports that the key could not be read.
  It must never fall back to serving unauthenticated traffic, which would be the
  present bug wearing a checkbox.
