# Testing Strategy

## Test layers

### Unit

Test:

- provider normalization;
- model mapping;
- routing;
- cost calculation;
- schema validation;
- error mapping.

### Integration

Test:

- SQLite;
- credential service;
- provider adapters against mocked HTTP servers;
- gateway routes;
- streaming;
- cancellation.

### End-to-end

Test:

1. Start application.
2. Add mock provider.
3. Discover model.
4. Select virtual model.
5. Start gateway.
6. Send OpenAI-compatible request.
7. Receive streamed response.
8. Verify usage record.

## Mock provider

Tests must not call paid cloud APIs.

Create a deterministic local mock provider supporting:

- normal response;
- streaming;
- auth failure;
- rate limit;
- timeout;
- malformed upstream response.

## Compatibility tests

Use a small collection of OpenAI SDK/curl-style requests.

## Security tests

Verify:

- no credential leakage;
- localhost binding;
- invalid IPC rejected;
- oversized request rejected;
- malformed JSON rejected;
- provider URL validation.

## Definition of test success

All tests must be deterministic and runnable offline except explicitly marked optional live-provider tests.
