# T201 — Provider Core

## Goal

Create provider-neutral interfaces and normalized model/request/response types.

## Deliverables

- ProviderAdapter interface.
- ProviderRegistry.
- normalized chat request;
- normalized stream chunk;
- model capability type;
- normalized provider error;
- adapter contract tests.

## Acceptance criteria

- [ ] no UI dependencies;
- [ ] no SQLite dependencies;
- [ ] provider adapter can be mocked;
- [ ] stream chunks support text, tool calls and finish reason;
- [ ] abort signal is part of request context.
