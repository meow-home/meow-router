# OAuth (Antigravity) — Khung Đăng Nhập Tài Khoản qua OAuth

**Ngày:** 2026-09-07
**Trạng thái:** Approved (thiết kế) — chờ pha implementation

## Mục tiêu

Cho phép meow-gateway đăng nhập tài khoản qua OAuth (Google + Antigravity Cloud Code), lưu token an toàn qua OS secure store, và map vào gateway để dùng như một provider — tương đương cách `cockpit-tools` uỷ quyền Antigravity.

Bản thiết kế này nhắm tới một **khung OAuth tổng quát, provider-neutral**, có thể tái dùng cho các provider OAuth khác sau này, với **Antigravity là provider đầu tiên** được cài lên.

## Phạm vi / Cận lề

### Trong phạm vi
- Package `oauth-core` (provider-neutral): callback server, token client, token store interface, token manager (refresh tự động).
- Package `provider-antigravity`: adapter (chat, điscovery models, validate credentials) qua API Cloud Code `v1internal:*`.
- Main-process wiring: `OAuthTokenStore`, `OAuthLoginService`, IPC handlers, registry registration.
- UI: trang "OAuth Accounts" (login, list, sign-out).
- Tests (unit + integration offline), docs, typecheck, lint.

### Ngoài phạm vi
- Multi-provider OAuth hoàn chỉnh (chỉ Antigravity được cài; khung sẵn cho tương lai).
- Quản lý quota/hạn sử dụng Antigravity.
- Cơ chế "wakeup"/runtime Antigravity IDE (không cần — ta chỉ gọi HTTP API).

## Kiến trúc tổng quan

```
packages/
  oauth-core/               (mới, provider-neutral, không phụ thuộc Electron/UI)
    types.ts                OAuthTokenBundle, OAuthClientConfig, OAuthUserInfo
    tokenClient.ts          exchangeCode / refreshAccessToken / getUserInfo (HTTP thuần, injectable fetcher)
    callbackServer.ts       local HTTP server 127.0.0.1:0, /oauth-callback, validate state
    oauthFlow.ts            prepareAuthUrl → openBrowser → waitForCode → exchangeCode
    tokenStore.ts           interface OAuthTokenStore (get/set/delete theo ref)
    tokenManager.ts         getAccessToken / getUserInfo / listAccounts / logout / setProjectId
  provider-antigravity/     (mới)
    metadata.ts             id 'antigravity', baseUrls, authType 'oauth', client config (dev-only)
    project.ts              resolveProjectId qua v1internal:loadCodeAssist / onboardUser
    adapter.ts              ProviderAdapter: chat + getModels + validateCredentials
    index.ts
apps/desktop/src/main/
  oauth/
    oauthTokenStore.ts      implements OAuthTokenStore (wrap CredentialService, JSON bundle)
    oauthLoginService.ts    IPC service: startLogin / completeLogin / listAccounts / logout
  app/bootstrap.ts          wire store+manager, register antigravity adapter + IPC
  gateway/server.ts         (không đổi — getCredential trả bundle JSON, adapter tự refresh)
apps/desktop/src/render/src/
  views/OAuthAccountsView.tsx
  components/Sidebar.tsx    (thêm mục)
  App.tsx                   (thêm view)
apps/desktop/src/shared/ipc.ts   (thêm channel oauth.*)
apps/desktop/src/preload/index.ts (thêm API)
```

### Nguyên tắc then chốt
Gateway hiện gọi `getCredential(refFor(providerId))` → trả một string. Với OAuth, string đó là **JSON token bundle**. Adapter Antigravity được inject `OAuthTokenManager` (DI tại process boundary — đúng AGENTS.md). Renderer và IPC **không bao giờ nhận token bundle** — chỉ metadata an toàn.

## `oauth-core` package

### types.ts
```ts
export interface OAuthTokenBundle {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresAt: number          // epoch ms
  idToken?: string
  oauthClientKey?: string
  scope?: string
  projectId?: string         // Antigravity: resolve lúc gọi API, cache lại
}

export interface OAuthClientConfig {
  clientId: string
  clientSecret: string
  authUrl: string
  tokenUrl: string
  userInfoUrl?: string
  scopes: string[]
}

export interface OAuthUserInfo {
  id?: string
  email: string
  name?: string
  picture?: string
}
```

### tokenClient.ts
HTTP thuần, injectable `Fetcher` (mẫu `provider-openai/http.ts`).
- `exchangeCode(config, code, redirectUri)` → POST tokenUrl (`grant_type=authorization_code`) → `OAuthTokenBundle` (tính `expiresAt = now + expires_in*1000`).
- `refreshAccessToken(config, refreshToken)` → POST tokenUrl (`grant_type=refresh_token`) → bundle mới.
- `getUserInfo(config, accessToken)` → GET userInfoUrl (`Authorization: Bearer`) → `OAuthUserInfo`.

### callbackServer.ts
Port từ `oauth_server.rs` của cockpit-tools.
- `startCallbackServer()` → bind `127.0.0.1:0` → `{ port, redirectUri, waitForCode(state, timeoutMs): Promise<{code,state}> }`.
- Validate `state` khớp; timeout 10 phút; hỗ trợ cancel.
- Trả HTML "授权成功/授权失败" cho browser.

### oauthFlow.ts
- `prepareAuthUrl(config, redirectUri, state)` → build URL (`response_type=code&client_id&redirect_uri&scope&state`).
- `runOAuthFlow(config, openBrowser)` → start server → mở browser → chờ code → exchange → `{ bundle, userInfo }`.

### tokenStore.ts
```ts
export interface OAuthTokenStore {
  get(ref: string): Promise<OAuthTokenBundle | null>
  set(ref: string, bundle: OAuthTokenBundle): Promise<void>
  delete(ref: string): Promise<void>
}
```

### tokenManager.ts
`OAuthTokenManager`:
- `getAccessToken(ref)`: đọc bundle; nếu `expiresAt - now > 300s` → trả accessToken; ngược lại refresh → ghi lại bundle mới (giữ refreshToken + projectId) → trả token; fail → ném `AUTH_ERROR`.
- `getUserInfo(ref)`, `listAccounts()`, `logout(ref)`.
- `setAccessToken(ref)` / `setProjectId(ref, id)` dùng cho adapter cache lại projectId.

### Test — oauth-core
- `tokenClient.test.ts`: mock HTTP (exchange/refresh/userinfo, error mapping).
- `callbackServer.test.ts`: bind port thật, gửi request HTTP, assert code+state + validate sai state.
- `tokenManager.test.ts`: mock store + client, test refresh threshold (trước/ngay cận 300s).

## `provider-antigravity` package

Adapter **không** compose OpenAI-compatible (endpoint/body/SSE khác hẳn) — viết native. Provider-specific logic chỉ nằm trong adapter này.

### metadata.ts
```ts
export const antigravityMetadata = {
  id: 'antigravity',
  displayName: 'Antigravity',
  defaultBaseUrl: 'https://daily-cloudcode-pa.googleapis.com',
  authType: 'oauth',
  fallbackBaseUrls: [
    'https://daily-cloudcode-pa.googleapis.com',
    'https://cloudcode-pa.googleapis.com',
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
  ],
}
```
`OAuthClientConfig` cho Antigravity dùng client_id/client_secret của cockpit-tools — **dev-only, đánh dấu DANGER trong code comment**, thiết kế cho phép thay qua cấu hình sau.

### project.ts — resolve project_id (DYNAMIC theo account)
Antigravity cần `project` trong body, là giá trị **động theo account**, không có lúc login:
1. Đọc `bundle.projectId` — nếu có, dùng ngay.
2. Nếu chưa: POST `{base}/v1internal:loadCodeAssist` (Bearer, header `User-Agent: antigravity/<ver> <os>/<arch> google-api-nodejs-client/<ver>`, `x-goog-api-client: gl-node/<ver>`) → nếu response có `project.id` → cache → trả về.
3. Nếu tài khoản mới chưa có project: gọi `v1internal:onboardUser` + poll operation → lấy `project.id` → cache.

Header bắt buộc: `User-Agent`, `x-goog-api-client` (port constants trong metadata).

### adapter.ts — ProviderAdapter
- Constructor nhận `OAuthTokenManager` interface (DI để test inject mock).
- `getModels(ctx)`: `POST {base}/v1internal:fetchAvailableModels` với Bearer token (qua manager, từ `ctx.credentialRef`) → `ModelInfo[]`; fallback static list khi API fail.
- `validateCredentials(ctx)`: manager `getAccessToken(ref)` — hợp lệ/refresh được = ok.
- `chat(ctx, req)`: resolve projectId → build body (`{project, requestId, model, userAgent, requestType:'agent', request:{contents, session_id, systemInstruction, generationConfig}}`) → `POST {base}/v1internal:streamGenerateContent?alt=sse`.
- **Streaming:** parse SSE → `NormalizedChatChunk` (content_delta / finish); abort qua `ctx.signal`.
- **Error mapping:** 401/403 → `AUTH_ERROR`; 429 → `RATE_LIMIT`; 5xx → `PROVIDER_UNAVAILABLE`.
- **Fallback base URL:** thử lần lượt các fallbackBaseUrls; `DEFAULT_ATTEMPTS=2`.

### Test — provider-antigravity
- `adapter.test.ts`: `defineAdapterContractTests` (từ provider-core) + mock HTTP server (SSE chunks, error mapping, abort), mock `OAuthTokenManager`.
- `project.test.ts`: mock loadCodeAssist (nhiều case: có/không project, onboardUser + poll).

## Main-process wiring

### oauth/oauthTokenStore.ts
Wrap `CredentialService`, bundle JSON qua secure store. Ref dùng `provider:<providerId>` (cùng quy ước gateway resolve), vì **1 provider = 1 account**.

### oauth/oauthLoginService.ts
`OAuthLoginService`: 
- `startOAuthLogin(type)` → build authUrl, mở browser (`shell.openExternal`), lưu state pending.
- `completeOAuthLogin()` → chờ callback, exchange, getUserInfo → **tạo provider** (type `antigravity`, displayName = email) → lưu bundle vào `provider:<providerId>` → trả metadata an toàn.
- `listAccounts(type)` → liệt kê provider type = antigravity, metadata an toàn (email, displayName, expiresAt, valid) — **không token**.
- `logoutAccount(providerId)` → xóa credential + (tùy chọn) provider.

### bootstrap.ts
- Tạo `OAuthTokenStore` + `OAuthTokenManager`, register `createAntigravityAdapter(manager)`.
- Thêm nhánh IPC `IPC_CHANNELS.oauth.*` (validate input — AGENTS.md).

### Gateway server.ts
Không đổi.

### Map account → provider (1 provider = 1 account)
Đã quyết định: **mỗi provider Antigravity gắn đúng MỘT account Google**. Nhiều account = tạo nhiều provider (type `antigravity`). Điều này khớp kiến trúc hiện tại (provider ↔ 1 credential) và **không cần sửa gateway**:

- Gateway gọi `getCredential(refFor(providerId))` = `provider:<id>`. 
- Với Antigravity, bundle JSON lưu **qua cùng ref `provider:<id>`** (không phải ref `oauth:*` riêng). `OAuthTokenStore` map theo provider ref.
- OAuth login = **tạo provider** (type `antigravity`) + lưu bundle vào `provider:<id>`.
- Sign-out = xóa credential của provider đó.
- Adapter đọc bundle từ `ctx.credentialRef` (`provider:<id>`) qua manager.

Do đó `OAuthTokenStore.set/get/delete` dùng ref `provider:<providerId>`; không cần namespace `oauth:*` tách biệt. Adapter tự refresh/parse, cache projectId.

## IPC + Preload + UI

### shared/ipc.ts
```ts
interface OAuthAccountMeta {
  providerId: string; email: string; displayName: string;
  expiresAt: number; valid: boolean;
}
IPC_CHANNELS.oauth = {
  startLogin: 'oauth:startLogin',
  completeLogin: 'oauth:completeLogin',
  listAccounts: 'oauth:listAccounts',
  logout: 'oauth:logout',
}
```

### preload/index.ts
`window.meowGateway.oauth.*` wrap `IpcResult`.

### UI
- **Sidebar.tsx:** thêm mục `oauthaccounts` ("OAuth Accounts").
- **App.tsx:** thêm `OAuthAccountsView`.
- **OAuthAccountsView.tsx:**
  - Dropdown provider type OAuth (chỉ antigravity hiện tại).
  - Nút "Sign in with Google" → `oauth.startLogin` (mở browser) → "Waiting…" → `oauth.completeLogin` → hiển thị account (email, displayName, expiry, valid).
  - Danh sách account + nút "Sign out".
  - **Chỉ metadata an toàn, không token.**

## Bảo mật (tái khẳng định AGENTS.md)
- Token bundle chỉ ở main process, qua OS secure store; không log, không gửi renderer.
- `client_secret` hiện hardcode dev-only (theo yêu cầu user để chạy thử) — **đánh dấu DANGER**, thiết kế cho phép chuyển sang do người dùng nhập sau. Đây là vi phạm có chủ đích của "Do not hard-code provider secrets" — cần thay sau khi POC xong.
- Local callback server chỉ bind `127.0.0.1`, validate state đầy đủ.
- Validate toàn bộ IPC input.

## Bảo trì / Mở rộng
Thêm provider OAuth mới = thêm `OAuthClientConfig` + `metadata.ts` + adapter; không đổi oauth-core. Khung có sẵn cho Google/Claude/CodeBuddy... sau này.

## Định nghĩa hoàn thành
- Implementation xong (oauth-core + provider-antigravity + main wiring + UI).
- Unit + integration tests pass; typecheck pass; lint pass.
- Không secret trong log/tests/fixtures.
- Docs cập nhật (PROVIDER_ADAPTERS, API, ROADMAP).
- Acceptance criteria checked.
