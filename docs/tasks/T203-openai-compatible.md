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

- [x] mock provider tests pass;
- [x] non-streaming request works;
- [x] streaming request works;
- [x] auth failure is normalized;
- [x] rate limit is normalized;
- [x] upstream API key never appears in logs.
