# Provider Adapter Specification

## Purpose

Provider adapters isolate external API differences from the gateway.

## Provider categories

Initial targets:

1. DeepSeek
2. OpenAI
3. Anthropic
4. Google Gemini
5. OpenRouter
6. Zhipu/GLM
7. Qwen
8. Custom OpenAI-compatible

## Adapter responsibilities

An adapter owns:

- authentication;
- model discovery;
- endpoint construction;
- request translation;
- streaming translation;
- usage extraction;
- provider-specific error mapping.

It must not own:

- UI;
- SQLite persistence;
- routing policy;
- credential rendering;
- global logging configuration.

## Capability declaration

Each adapter/model can declare:

```ts
type ModelCapabilities = {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
};
```

## Provider context

```ts
type ProviderContext = {
  credential: SecretReference;
  baseUrl?: string;
  signal: AbortSignal;
  requestId: string;
};
```

The actual secret value should be passed only inside the main process.

## Credential validation

Validation should make the smallest safe request possible.

Do not send user prompts merely to validate a credential.

## Rate limits

Map provider rate-limit responses to:

`RATE_LIMIT`

Extract retry-after when available.

## Errors

Never expose raw provider responses if they contain sensitive headers or secrets.

Normalize:

- status;
- provider code;
- user-facing message;
- retryability.

## Adding a new provider

Create:

```text
providers/<provider-id>/
  adapter.ts
  metadata.ts
  schemas.ts
  adapter.test.ts
  fixtures/
```

Then register the adapter in the provider registry.

## OAuth-based providers (Antigravity)

Some providers authenticate with a Google account via OAuth instead of an API
key. Antigravity is the first such provider.

- The adapter declares `authType: 'oauth'`.
- **1 provider = 1 account**: a signed-in Google account creates a single
  `antigravity` provider row, and its display name is the account's email.
- The token bundle (access/refresh token, expiry, resolved project id) is stored
  through the OAuth token store, which is backed by the same OS secure store
  used for API keys. Neither raw tokens nor the refresh token ever reach the
  renderer.
- The Antigravity **project id is resolved lazily** on first use via
  `v1internal:loadCodeAssist` and cached in the token bundle. A brand-new
  account that has not created a project yet will surface a clear error instead
  of auto-provisioning (see `packages/provider-antigravity/src/project.ts`).
- The `loadCodeAssist` request uses the real Cloud Code Assist API contract:
  the POST body's `metadata` is a valid `ClientMetadata` (`ideName: 'GEMINI_CLI'`,
  `pluginType: 'GEMINI'`, `ideVersion`, `platform`) — matching google's own
  `gemini-cli` `CodeAssistServer`, and the project id is read from the
  response's `cloudaicompanionProject` field. Sending the wrong metadata shape
  (e.g. `{ appVersion }`) makes the server reject every request with
  `400 INVALID_ARGUMENT`, surfacing as "Could not resolve Antigravity project".
- Access tokens are auto-refreshed near expiry by the OAuth token manager before
  a request is sent.
- **Tool-call thought signatures**: the Cloud Code Assist API requires a
  `functionCall` part to carry its `thoughtSignature` when it is resent in a
  multi-turn history; omitting it yields `400 INVALID_ARGUMENT` ("Function call
  is missing a thought_signature in functionCall parts"). The adapter stashes
  the signature in the OpenAI tool-call `id` it emits to the client and recovers
  it when the client echoes that id back in an assistant `tool_calls`/tool
  `tool_call_id`, so the round-trip works without any client-side change.
- The gateway itself is provider-neutral and treats an OAuth provider like any
  other: it reads the credential at `provider:<id>` and dispatches through the
  adapter, so `gateway/server.ts` requires no special-casing.

### Credential notes (DANGER)

The Antigravity OAuth `client_id`/`client_secret` are currently hard-coded as
**dev-only** values in `metadata.ts`, mirroring the cockpit-tools reference.
This intentionally deviates from the "no hard-coded provider secrets" rule for
the POC and MUST be replaced with user-supplied credentials or a dedicated
secure backend before shipping. See the OAuth design spec's security section.
