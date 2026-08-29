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

- [x] no UI dependencies;
- [x] no SQLite dependencies;
- [x] provider adapter can be mocked;
- [x] stream chunks support text, tool calls and finish reason;
- [x] abort signal is part of request context.
