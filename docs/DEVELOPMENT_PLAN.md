# Development Plan

The project is built as vertical slices. An AI coding agent should complete one phase at a time.

## Phase 0 — Repository bootstrap

Goal: runnable Electron shell.

Tasks:

- T001 project scaffold
- T002 TypeScript/lint/test configuration
- T003 Electron security baseline
- T004 basic React shell

Exit criteria:

- app starts;
- typecheck passes;
- tests execute;
- renderer has no Node integration.

## Phase 1 — Persistence and credentials

Tasks:

- T101 database layer
- T102 migrations
- T103 secure credential service
- T104 provider CRUD
- T105 provider management UI

Exit criteria:

- provider can be created;
- credential stored securely;
- provider can be enabled/disabled;
- credentials are never persisted in SQLite.

## Phase 2 — Provider abstraction

Tasks:

- T201 provider core types
- T202 provider registry
- T203 OpenAI-compatible adapter
- T204 DeepSeek adapter
- T205 model discovery UI

Exit criteria:

- provider can validate credentials;
- models can be fetched;
- normalized models appear in UI.

## Phase 3 — Local gateway

Tasks:

- T301 gateway server
- T302 `/health`
- T303 `/v1/models`
- T304 `/v1/chat/completions`
- T305 streaming
- T306 cancellation/timeouts
- T307 gateway configuration UI

Exit criteria:

- curl/OpenAI SDK can call localhost;
- streaming works;
- selected virtual model reaches selected provider.

## Phase 4 — Virtual models

Tasks:

- T401 virtual model data model
- T402 model mapping UI
- T403 virtual model API exposure
- T404 active model switching

Exit criteria:

- agent uses stable model name;
- user changes provider/model without agent reconfiguration.

## Phase 5 — Usage and cost

Tasks:

- T501 usage extraction
- T502 cost calculator
- T503 request history
- T504 dashboard

Exit criteria:

- every completed request records usage;
- cost estimate is deterministic;
- dashboard totals match stored records.

## Phase 6 — Additional providers

Tasks:

- T601 OpenAI
- T602 Anthropic
- T603 Gemini
- T604 OpenRouter
- T605 Zhipu/GLM
- T606 Qwen

Each provider must have adapter tests and capability documentation.

## Phase 7 — Routing and fallback

Tasks:

- T701 routing policy
- T702 primary/fallback
- T703 retry policy
- T704 routing UI
- T705 routing integration tests

## Phase 8 — Production hardening

Tasks:

- T801 security audit
- T802 installer builds
- T803 crash-safe startup/shutdown
- T804 upgrade/migration testing
- T805 documentation
- T806 release checklist

## Rule

Do not start a later phase if the previous phase's exit criteria are failing unless the user explicitly requests parallel work.
