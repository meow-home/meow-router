# T203 — OpenAI-Compatible Adapter

## Goal

Implement a generic adapter for providers exposing OpenAI-compatible endpoints.

## Requirements

- configurable base URL;
- API key authentication;
- GET models;
- POST chat completions;
- SSE streaming;
- usage extraction;
- timeout;
- cancellation;
- normalized errors.

## Acceptance criteria

- [ ] mock provider tests pass;
- [ ] non-streaming request works;
- [ ] streaming request works;
- [ ] auth failure is normalized;
- [ ] rate limit is normalized;
- [ ] upstream API key never appears in logs.
