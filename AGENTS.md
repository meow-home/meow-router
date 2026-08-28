# AGENTS.md — Meow Gateway Engineering Instructions

## Mission

Implement Meow Gateway as a production-quality Electron desktop application that manages cloud AI providers and exposes a local OpenAI-compatible API.

## Mandatory reading order

Before coding, read:

1. `README.md`
2. `docs/PRD.md`
3. `docs/ARCHITECTURE.md`
4. `docs/API.md`
5. `docs/DATA_MODEL.md`
6. `docs/SECURITY.md`
7. `docs/DEVELOPMENT_PLAN.md`
8. The current task file under `docs/tasks/`

Then inspect the existing source tree before creating new abstractions.

## Engineering rules

- TypeScript strict mode.
- Prefer small, composable modules.
- Keep Electron main process, preload bridge and renderer responsibilities separated.
- Renderer MUST NOT receive raw API keys.
- Provider credentials MUST be stored through the OS secure credential store.
- Do not hard-code provider secrets.
- Local gateway binds to `127.0.0.1` by default, never `0.0.0.0`.
- Validate all IPC input.
- Validate all HTTP input.
- Never log credentials, authorization headers or request bodies by default.
- Streaming must be supported end-to-end.
- Abort/cancellation must propagate from client to provider when possible.
- Provider-specific logic belongs in provider adapters, not the gateway router.
- Gateway API contracts must remain provider-neutral.
- Use dependency injection at process boundaries.
- Every feature must include tests.
- Do not silently change public API contracts.
- Update documentation when behavior or configuration changes.

## Definition of done

A task is complete only when:

- Implementation is finished.
- Unit tests pass.
- Integration tests relevant to the task pass.
- Typecheck passes.
- Lint passes.
- No secrets appear in logs/tests/fixtures.
- Relevant docs are updated.
- Acceptance criteria in the task file are checked.

## Preferred workflow

1. Inspect.
2. Plan.
3. Implement the smallest vertical slice.
4. Test.
5. Review against acceptance criteria.
6. Update docs.
7. Report changed files and remaining risks.

## Do not

- Rewrite unrelated files.
- Introduce a framework solely for convenience.
- Couple renderer UI directly to provider SDKs.
- Store credentials in SQLite/plain JSON.
- Add provider-specific conditionals throughout the codebase.
- Build speculative features before the current phase is stable.
