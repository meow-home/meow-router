# T304 — Chat Completions

## Goal

Implement `/v1/chat/completions`.

## Requirements

- OpenAI-compatible request validation;
- virtual model resolution;
- provider dispatch;
- non-streaming response;
- error mapping.

## Acceptance criteria

- [x] valid request reaches selected provider;
- [x] unknown model returns MODEL_NOT_FOUND;
- [x] malformed request returns client error;
- [x] provider authentication failure is mapped;
- [x] request ID is included in internal logs.
