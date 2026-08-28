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
