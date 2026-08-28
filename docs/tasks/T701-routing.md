# T701 — Routing & Fallback

## Goal

Support primary/fallback virtual model routing.

## MVP strategy

Sequential fallback:

```text
Primary
  |
  +-- success --> response
  |
  +-- retryable failure --> fallback
```

## Never fallback automatically for

- invalid user request;
- invalid API key when the same credential is reused;
- unsupported model capability;
- content policy/provider rejection unless explicitly configured.

## Acceptance criteria

- [ ] primary provider is attempted first;
- [ ] only retryable failures trigger fallback;
- [ ] fallback attempt is observable;
- [ ] duplicate billing is represented correctly;
- [ ] loop prevention exists.
