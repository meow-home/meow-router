# Codex (OpenAI) OAuth + Provider — Thiết Kế

**Ngày:** 2026-09-09
**Trạng thái:** Approved (thiết kế) — chờ pha implementation

## Mục tiêu

Cho phép meow-gateway đăng nhập tài khoản **Codex (OpenAI)** qua OAuth (flow PKCE browser redirect), lưu token an toàn qua OS secure store, và map vào gateway để dùng như một provider — port toàn bộ Codex feature trọng yếu từ `cockpit-tools` (tham khảo `D:\GitHub\cockpit-tools\src-tauri\src\modules\codex_oauth.rs`).

Nhu cầu **route chat completions qua OpenAI API** bằng token OAuth (không phải API key), dùng lại khung OAuth provider-neutral đã có từ Antigravity.

## Phạm vi / Cận lề

### Trong phạm vi
- Mở rộng `oauth-core` để hỗ trợ **PKCE** (`code_verifier` + `code_challenge` S256) — hiện chỉ có authorization-code cơ bản.
- Package mới `provider-codex`: `metadata.ts`, `tokenClient.ts` (PKCE exchange + refresh, decode id_token), `adapter.ts` (chat + models + validate credentials).
- Main-process wiring: thêm entry `'codex'` vào `OAUTH_CLIENT_FOR_TYPE` + `tokenClientForType` DI trong `OAuthLoginService`.
- IPC + preload + UI: thêm Codex vào provider management / OAuth login.
- Tests (unit + integration offline), typecheck, lint.
- Docs cập nhật.

### Ngoài phạm vi
- Device auth flow (mã user_code) — chỉ làm PKCE browser redirect.
- Quota/hạn sử dụng Codex (thym, weekly reset, fingerprint mode, policy modal) — port sau nếu cần.
- Agent identity / SSH / local access sidecar / official client injection của cockpit-tools — quá nặng, không cần cho gateway.
- Wakeup/runtime Codex desktop app — ta chỉ gọi HTTP API OpenAI.

## Kiến trúc tổng quan

```
packages/
  oauth-core/               (SỬA — thêm PKCE, provider-neutral)
    src/pkce.ts             generatePkcePair(): { codeVerifier, codeChallenge(S256) }
    src/oauthFlow.ts        prepareAuth() thêm option pkce?: boolean, trả pkcePair
  provider-codex/           (MỚI)
    src/
      metadata.ts           CODEX_OAUTH_CLIENT (public client, không secret), baseUrl, identity header
      pkceClient.ts         CodexTokenClient: exchangeCode(code, pkcePair, redirectUri) / refresh
      userIdentity.ts       decode id_token JWT → email/userId (Codex không có userInfoUrl)
      adapter.ts            CodexAdapter: ProviderAdapter (chat, models, validate)
      index.ts
apps/desktop/src/main/
  oauth/
    antigravityConfig.ts    (SỬA) thêm 'codex' → CODEX_OAUTH_CLIENT
    oauthLoginService.ts    (SỬA nhẹ) support getUserInfo qua id_token decode
apps/desktop/src/shared/ipc.ts         (thêm loại type 'codex' — có sẵn generic)
apps/desktop/src/render/src/           (UI: thêm Codex provider type)
```

### Nguyên tắc then chốt (đúng AGENTS.md)
- Provider-specific logic nằm trong `provider-codex` adapter, không thảy vào gateway router.
- Renderer/IPC **không bao giờ** nhận raw `access_token`/`refresh_token`/`id_token`.
- `code_verifier` chỉ tồn tại trong main-process `pending` state — không qua IPC.
- Token bundle lưu trong OS secure store qua `OAuthTokenStore` (JSON bundle tại ref `provider:<providerId>`).
- Không log token/authorization headers.

## Codex OAuth — thông số (tham chiếu cockpit-tools)

```ts
// metadata.ts
export const CODEX_OAUTH_CLIENT: OAuthClientConfig = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann', // public client ID for PKCE desktop
  clientSecret: '',                        // PKCE: không dùng secret
  authUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  userInfoUrl: undefined,                  // Codex KHÔNG có endpoint userinfo → decode id_token
  scopes: [
    'openid', 'profile', 'email', 'offline_access',
    'api.connectors.read', 'api.connectors.invoke'
  ]
}
```

Khác biệt chính so với Antigravity:
1. **PKCE bắt buộc** — authorize URL có `code_challenge=S256` + `code_challenge_method=S256`; token exchange có `code_verifier`.
2. **Không client_secret** trong body/form.
3. **Không userInfoUrl** — email/account lấy từ decode `id_token` JWT (payload `email`, `sub`).
4. Request API cần header đặc trưng: `originator: Codex Desktop` (không chứa credential).

## `oauth-core` — PKCE extension

### src/pkce.ts (mới)
```ts
export interface PkcePair {
  codeVerifier: string   // 43-128 chars, base64url random (crypto.randomBytes)
  codeChallenge: string  // Base64Url(SHA-256(codeVerifier))
}
export function generatePkcePair(): PkcePair
```

### src/oauthFlow.ts (sửa)
- `OAuthFlowOptions` thêm `pkce?: boolean`.
- Khi `pkce: true`:
  - sinh `PkcePair`, thêm `code_challenge` + `code_challenge_method=S256` vào auth URL query.
- `PreparedAuth` thêm `pkcePair?: PkcePair` để main-process exchange sau đó.
- `waitForCallback()` trả `{ code }` như trước.

### Test — oauth-core
- `pkce.test.ts`: độ dài verifier hợp lệ, base64url alphabet, `S256(codeVerifier) === codeChallenge` (tính lại bằng node crypto).

## `provider-codex` package

### tokenClient.ts — CodexTokenClient
HTTP thuần, injectable `Fetcher` (mẫu `oauth-core/tokenClient.ts`).
- `exchangeCode(code, pkcePair, redirectUri)` → POST tokenUrl `grant_type=authorization_code`, body form: `client_id, code, redirect_uri, code_verifier` → `OAuthTokenPair`.
- `refreshAccessToken(refreshToken)` → POST tokenUrl `grant_type=refresh_token`, body: `client_id, refresh_token` → `OAuthTokenPair`.
- Parse `access_token`, `refresh_token`, `expires_in`, `id_token`, `scope` (giống `parseTokenPair` của oauth-core). Error mapping: 400 → `invalid_grant`, khác → network/server.
- Mã hoá form bằng `URLSearchParams`.

> Có thể tái dùng `parseTokenPair`/`OAuthTokenClientError` — export thêm từ oauth-core nếu cần để không duplicate.

### userIdentity.ts — decode id_token
Codex không có userinfo endpoint nên parse JWT:
```ts
export function decodeIdToken(idToken: string):
  { sub?: string; email?: string; name?: string }
```
- Tách payload base64url, `JSON.parse` (bỏ signature/header).
- Không verify signature ở pha thiết kế (token từ chính Auth0 token endpoint tin cậy); có thể bổ sung JWKS-verify sau. **KHÔNG log payload**.
- `email`/`sub` → dùng cho `OAuthAccountMeta.email` / `displayName`.

### adapter.ts — CodexAdapter
- Constructor nhận `OAuthTokenManager` (DI, mẫu Antigravity adapter).
- `baseUrl` mặc định `https://api.openai.com` (chat), fallback list.
- `chat(ctx, req)`:
  - `getAccessToken(ctx.credentialRef)` → `Bearer` token (manager tự refresh).
  - Forward tới OpenAI **Responses API** `POST /v1/responses` làm chính (phù hợp Codex/agentic; token auth.openai.com dùng được trên responses).
  - **Fallback:** nếu Responses API trả 404/400 do model không hỗ trợ, thử `POST /v1/chat/completions` cùng body đã chuẩn hoá.
  - Header: `Authorization: Bearer <token>`, `Content-Type: application/json`, `originator: Codex Desktop`.
  - Streaming: parse SSE → `NormalizedChatChunk` (content_delta / finish); abort qua `ctx.signal`.
- `getModels(ctx)`: `GET /v1/models` (Bearer) → `ModelInfo[]`; fallback static list khi fail.
- `validateCredentials(ctx)`: manager `getAccessToken(ref)` ok = hợp lệ.
- Error mapping: 401/403 → `AUTH_ERROR`; 429 → `RATE_LIMIT`; 5xx → `PROVIDER_UNAVAILABLE`.

### Test — provider-codex
- `tokenClient.test.ts`: mock fetch (exchange/refresh, error, thiếu key).
- `adapter.test.ts`: `defineAdapterContractTests` (từ provider-core) + mock HTTP (SSE chunks, error mapping, abort), mock `OAuthTokenManager`.
- `userIdentity.test.ts`: decode id_token hợp lệ / malformed.

## Main-process wiring

### antigravityConfig.ts (sửa)
```ts
export const OAUTH_CLIENT_FOR_TYPE: Record<string, OAuthClientConfig> = {
  antigravity: ANTIGRAVITY_OAUTH_CLIENT,
  codex: CODEX_OAUTH_CLIENT
}
```

### oauthLoginService.ts (sửa nhỏ)
- Thêm `tokenClientForType(type)` trả `CodexTokenClient` khi type = `codex`.
- `completeLoginFor`: sau khi exchange, nếu config không có `userInfoUrl` → `getUserInfo` decode từ `pair.idToken` (không gọi HTTP).
  - Chỗ này cần chuẩn hoá: `OAuthTokenClient.getUserInfo` hiện throw khi thiếu `userInfoUrl`. Thêm nhánh: nếu thiếu, dùng `idTokenToUserInfo(pair.idToken)`.
- Còn lại giữ nguyên (tạo provider type `codex`, lưu bundle, trả meta an toàn).

> `OAuthTokenManager` hiện hỗ trợ refresh chuẩn (`client_secret` + `client_id`). Với Codex (PKCE, không secret) cần cho phép refresh gửi **chỉ** `client_id + refresh_token` (chuẩn Auth0). Kiểm tra/điều chỉnh `tokenClientForType` để refresh dùng đúng `CodexTokenClient.refreshAccessToken`. Mỗi provider có riêng token client → không đổi manager.

## IPC + Preload + UI

Không cần thêm IPC channel mới — `oauthStartLogin(type)` / `oauthCompleteLogin(type)` / `oauthListAccounts(type)` đã generic với `type`. Chỉ cần:
- `listProviderTypes()` trả thêm type `codex` ("Codex (OpenAI)").
- UI thêm Codex vào dropdown + nút Sign in.

### preload
Không đổi (API OAuth đã có sẵn).

### UI (render/src)
- Provider type selector: thêm `codex` entry.
- OAuth Accounts view: chọn Codex → "Sign in with Codex" → `oauth.startLogin('codex')` (mở browser auth.openai.com) → "Waiting…" → `oauth.completeLogin('codex')` → hiển thị account (email từ id_token, expiry, valid).
- Chỉ metadata an toàn, không token.

## Bảo mật (tái khẳng định AGENTS.md)
- Token bundle chỉ ở main-process, qua OS secure store.
- **Client ID của Codex là public** (PKCE public client, không phải secret) — không vi phạm "do not hard-code provider secrets". Không có `client_secret`.
- `code_verifier` trong main-process `pending` state, không qua IPC.
- Callback server bind `127.0.0.1`, validate state.
- `originator: Codex Desktop` header — không chứa credential.
- Validate toàn bộ IPC input.

## Bảo trì / Mở rộng
Khung OAuth provider-neutral đã sẵn; thêm Codex = metadata + token client + adapter, không đổi oauth-core core flow (chỉ thêm PKCE generic).

## Định nghĩa hoàn thành
- Implementation xong (oauth-core PKCE + provider-codex + main wiring + UI).
- Unit + integration tests pass; typecheck pass; lint pass.
- Không secret trong log/tests/fixtures.
- Docs cập nhật (PROVIDER_ADAPTERS, API).
- Acceptance criteria checked.
