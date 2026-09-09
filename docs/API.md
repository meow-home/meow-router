# Local Gateway API

Base URL:

`http://127.0.0.1:17135/v1`

## Authentication

The gateway requires an API key by default. Send it as a bearer token:

```http
Authorization: Bearer <local-gateway-key>
```

The local gateway key is independent from cloud provider API keys. Find it in
the desktop app under Gateway -> Gateway API key; Copy puts the full key on your
clipboard.

`GET /health` never requires the key, so a liveness probe works unauthenticated.

A missing, malformed or wrong key returns 401:

```json
{
  "error": {
    "message": "Missing or invalid gateway API key.",
    "type": "invalid_request_error",
    "code": "GATEWAY_AUTH_REQUIRED"
  }
}
```

Authentication can be turned off in Gateway -> Require gateway API key. With it
off the gateway serves any loopback client.

## GET /health

Returns:

```json
{
  "status": "ok",
  "version": "0.5.1",
  "gateway": {
    "running": true
  }
}
```

## GET /v1/models

Returns OpenAI-compatible model objects.

```json
{
  "object": "list",
  "data": [
    {
      "id": "meow-coding",
      "object": "model",
      "owned_by": "meow-gateway"
    }
  ]
}
```

## POST /v1/chat/completions

Input should accept the common OpenAI chat completion subset:

- model
- messages
- temperature
- top_p
- max_tokens
- stream
- tools
- tool_choice
- response_format where supported

Example:

```json
{
  "model": "meow-coding",
  "messages": [
    {
      "role": "user",
      "content": "Explain this function."
    }
  ],
  "stream": true
}
```

## POST /v1/messages (Anthropic Messages API)

Anthropic-native clients (e.g. Claude Code) talk to the gateway over the
Anthropic Messages wire format. The gateway translates the request to its
provider-neutral contract, dispatches to the selected provider, then serializes
the response back into Anthropic Messages format.

Input accepts the common Anthropic Messages subset:

- model
- max_tokens (required)
- messages
- system
- temperature
- top_p
- stream
- tools
- tool_choice
- stop_sequences

Example:

```json
{
  "model": "meo-claude",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "Explain this function." }
  ],
  "stream": true
}
```

Non-streaming returns an Anthropic `message` object:

```json
{
  "id": "…",
  "type": "message",
  "role": "assistant",
  "model": "meo-claude",
  "content": [{ "type": "text", "text": "…" }],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": { "input_tokens": 5, "output_tokens": 2 }
}
```

Streaming uses Server-Sent Events with the Anthropic event sequence
(`message_start`, `content_block_start`, `content_block_delta`,
`content_block_stop`, `message_delta`, `message_stop`), terminated by
`data: [DONE]`.

## Streaming

Use Server-Sent Events.

Each chunk must be emitted as:

```text
data: {...}

```

Finish with:

```text
data: [DONE]

```

Reasoning models (e.g. Antigravity's gemini-2.5-flash) stream their chain-of-thought as OpenAI-compatible `delta.reasoning_content` chunks before the final `content` delta. Clients that understand reasoning (the AI SDK reads `delta.reasoning_content` or `delta.reasoning`) can surface it; others simply ignore it.

## Virtual model resolution

Example configuration:

```json
{
  "id": "meow-coding",
  "providerId": "deepseek",
  "providerModelId": "deepseek-chat"
}
```

The client only sees `meow-coding`.

## Error contract

Use OpenAI-compatible error structure where possible:

```json
{
  "error": {
    "message": "Provider authentication failed",
    "type": "authentication_error",
    "code": "PROVIDER_AUTH_FAILED"
  }
}
```

Never return provider secrets or upstream authorization headers.

### Request body size limit

The gateway accepts request bodies up to **10 MiB** by default. A body that
exceeds the limit is drained (the connection is not torn down) and rejected
with an HTTP `413` and the standard error envelope:

```json
{
  "error": {
    "message": "Request body exceeds the size limit.",
    "type": "invalid_request_error",
    "code": "INVALID_REQUEST"
  }
}
```

## API compatibility strategy

MVP targets the common OpenAI Chat Completions contract.

Provider-specific capabilities are represented internally and may be rejected explicitly when unsupported rather than silently dropped.

## Renderer ↔ main IPC (WindowApi)

Beyond the HTTP gateway, the desktop renderer talks to the Electron main process
over a typed IPC bridge. Contract types live in `apps/desktop/src/shared/ipc.ts`
and are re-exported as `@shared/ipc`. The preload exposes a single
`window.meowGateway` object matching the `WindowApi` interface. All IPC payloads are schema-validated;
only non-sensitive data crosses this boundary (credentials never do).

### OAuth-authenticated providers (Antigravity, Codex)

OAuth-backed providers (Antigravity, Codex) do **not** take an API key. They
are signed in through the desktop **OAuth Accounts** view, which runs a local
loopback OAuth flow:

- `oauthStartLogin(type)` opens the system browser against the provider's
  authorization URL and starts a local callback server on `127.0.0.1`.
- `oauthCompleteLogin(type)` waits for the browser redirect, exchanges the
  authorization code, fetches the account's userinfo, creates a provider row
  (display name = the account's email), and persists the token bundle to the OS
  secure store at the gateway credential ref `provider:<id>`.
- `oauthListAccounts(type)` returns non-sensitive metadata only (provider id,
  email, display name, expiry, validity) — never tokens.
- `oauthLogout(providerId)` revokes and removes the account.

From the gateway's perspective an OAuth provider behaves like any other: the
gateway reads `provider:<id>` and dispatches through the provider adapter,
which auto-refreshes the access token near expiry.

The **Codex** provider (`type: 'codex'`) uses PKCE OAuth against
`auth.openai.com` (no `client_secret`; identity from the `id_token` JWT).
Chat is routed through the OpenAI Responses API (`/v1/responses`) with a
fallback to `/v1/chat/completions`. The Antigravity adapter resolves its
project id lazily on first use.

### Channels

- `model.create`
- `model.update`

### WindowApi methods

```ts
createModel(input: NewModel): Promise<ModelRow>
updateModel(id: string, patch: Partial<Omit<NewModel, 'id'>>): Promise<ModelRow>
```

`createModel` creates a manually-entered model. `updateModel` patches an
existing model and returns the updated row. The patch type excludes `id`
(`Partial<Omit<NewModel, 'id'>>`), so `id` is immutable after creation.

### `NewModel` (re-exported from `@shared/ipc`)

`NewModel` is originally defined in `apps/desktop/src/main/database/types.ts`
and re-exported by `@shared/ipc`. Fields:

- `id?: string` — optional, repository-generated (ignored on create)
- `provider_id: string`
- `provider_model_id: string`
- `display_name: string`
- `context_window?: number | null`
- `input_price?: number | null`
- `output_price?: number | null`
- `capabilities_json?: string | null`
- `enabled?: boolean`

Optional fields default in the repository (`enabled` defaults to `true`).
`id` and timestamps are generated by the repository.

### `ModelRow.stale`

`ModelRow` includes `stale: boolean`. When a provider sync discovers the
current model list, models missing from the provider API are marked `stale`
rather than deleted. `stale` is surfaced in the UI and can be re-enabled or
re-created as needed.
