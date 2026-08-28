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
