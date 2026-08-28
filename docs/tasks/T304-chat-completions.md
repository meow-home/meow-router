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

- [ ] valid request reaches selected provider;
- [ ] unknown model returns MODEL_NOT_FOUND;
- [ ] malformed request returns client error;
- [ ] provider authentication failure is mapped;
- [ ] request ID is included in internal logs.
