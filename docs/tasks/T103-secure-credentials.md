# T103 — Secure Credential Service

## Goal

Create a main-process-only credential service backed by the operating system secure credential store.

## API

```ts
setCredential(ref: string, secret: string): Promise<void>
getCredential(ref: string): Promise<string | null>
deleteCredential(ref: string): Promise<void>
hasCredential(ref: string): Promise<boolean>
```

## Acceptance criteria

- [ ] renderer never receives credentials unless strictly required by an internal main-process operation;
- [ ] credential survives application restart;
- [ ] credential is not stored in SQLite;
- [ ] credential is not logged;
- [ ] unit tests use a mock credential backend;
- [ ] errors are mapped to safe user-facing messages.
