# Meow Gateway

Local AI Model Gateway & Provider Manager for coding agents.

## Vision

Meow Gateway is a cross-platform Electron desktop application that lets users:

1. Connect AI model providers.
2. Securely store provider credentials.
3. Discover available models.
4. Select an active model or create a virtual model.
5. Expose an OpenAI-compatible API on localhost.
6. Route requests to the selected provider/model.
7. Track requests, tokens, latency, errors and estimated cost.
8. Optionally configure fallback providers and routing policies.

The primary consumer is a coding agent such as Meow Coding, OpenCode, Claude Code, Aider, Cline/Roo Code or another OpenAI-compatible client.

## Providers

OpenAI-compatible providers can be added by choosing a provider type and typing
a base URL. Presets include OpenAI, OpenRouter, Groq and opencode Zen
(`https://opencode.ai/zen/v1`) as remote endpoints; DeepSeek and a generic
"OpenAI-compatible" type are also available.

Ollama and LM Studio are NOT currently available as selectable providers: their
loopback endpoints (`http://127.0.0.1:11434/v1`, `http://127.0.0.1:1234/v1`) are
blocked by the SSRF guard, and their presets are not wired into the runtime
provider registry. They are possible/planned future presets but do not appear in
the provider picker in this slice.

## Sync Models

"Sync Models" (formerly "Refresh") re-discovers a provider's model list. It
preserves the user's enabled/disabled choice and marks models that are absent
from the provider API as `stale`; it never deletes models.

## Architecture

Single local endpoint:

`http://127.0.0.1:8317/v1`

The agent talks to Meow Gateway. Meow Gateway handles provider authentication, model selection, protocol translation, routing, streaming, retries and usage tracking.

## Development

Prerequisites: Node 20+, pnpm (install with `npm i -g pnpm`).

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
```

## Documentation

See `docs/` for the PRD, architecture, API, data model, security model and development plan. AI coding agents MUST read `AGENTS.md` before modifying code.
