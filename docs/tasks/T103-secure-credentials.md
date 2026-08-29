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

- [x] renderer never receives credentials unless strictly required by an internal main-process operation;
- [x] credential survives application restart;
- [x] credential is not stored in SQLite;
- [x] credential is not logged;
- [x] unit tests use a mock credential backend;
- [x] errors are mapped to safe user-facing messages.
