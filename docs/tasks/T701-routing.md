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

- [x] primary provider is attempted first;
- [x] only retryable failures trigger fallback;
- [x] fallback attempt is observable;
- [x] duplicate billing is represented correctly;
- [x] loop prevention exists.
