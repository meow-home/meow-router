# Roadmap

## v0.1 — Foundation

- Electron shell
- secure storage
- SQLite
- provider registry
- OpenAI-compatible adapter
- DeepSeek adapter
- local gateway
- virtual models

## v0.2 — Observability

- request history
- token metrics
- cost dashboard
- latency/error charts
- export usage data

## v0.3 — Provider expansion

- OpenAI
- Anthropic
- Gemini
- OpenRouter
- Zhipu/GLM
- Qwen

## v0.2.1 — OAuth accounts (Antigravity)

- OAuth-core package (authorization flow, callback server, token refresh)
- Antigravity adapter (project-id resolution, SSE streaming)
- desktop OAuth Accounts view + IPC
- 1 provider = 1 Google account
- dev-only OAuth client credentials (to be replaced before release)

## v0.4 — Routing

- primary/fallback
- retry policy
- model groups
- capability-aware routing
- budget-aware routing

## v0.5 — Agent integration

- one-click configuration snippets;
- copy configuration for popular coding agents;
- optional Meow Coding integration;
- per-client gateway keys.

## v1.0

- production installers;
- migration guarantees;
- security audit;
- robust provider compatibility;
- polished UX.
