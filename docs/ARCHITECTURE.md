# Architecture

## 1. High-level

```text
+-------------------------------------------------------+
| Electron                                              |
|                                                       |
|  Renderer (React)                                     |
|      |                                                |
|      | validated IPC                                  |
|      v                                                |
|  Preload                                              |
|      |                                                |
|      v                                                |
|  Main Process                                         |
|      |                                                |
|      +---- Config Service                             |
|      +---- Credential Service --> OS Keychain         |
|      +---- Model Service                              |
|      +---- Usage Service --> SQLite                   |
|      +---- Gateway Manager                            |
|      +---- Provider Registry                           |
|                 |                                     |
|                 +--> Provider Adapters                 |
|                                                       |
+-----------------------+-------------------------------+
                        |
                        | localhost HTTP
                        v
              OpenAI-compatible Gateway
                        |
                        v
                 Router / Policy
                        |
                        v
                 Provider Adapter
                        |
                        v
                  Cloud Provider
```

## 2. Process boundaries

### Single instance

Meow Gateway is a background service, so only one instance may run at a time.
The main process calls `app.requestSingleInstanceLock()` before booting anything.
If another copy already holds the lock (e.g. the user double-clicks the app
icon), the second process quits immediately and never creates a window, tray
icon, or gateway server. The primary instance receives a `second-instance`
event and re-focuses its existing window, so the user lands on the running app.

### Renderer

Responsible for presentation and user interaction.

Must not:

- hold raw provider credentials;
- call provider APIs directly;
- start arbitrary local servers.

### Preload

Provides a narrow typed IPC API.

### Main

Owns privileged operations:

- secure credentials;
- filesystem;
- database;
- provider SDK/API calls;
- gateway lifecycle.

### Gateway

Runs as a local HTTP server owned by the Electron main process or a dedicated Node worker.

## 3. Suggested package structure

```text
src/
  main/
    app/
    ipc/
    gateway/
    providers/
    credentials/
    database/
    services/
  preload/
  renderer/
    pages/
    components/
    stores/
    api/
  shared/
    types/
    schemas/

packages/
  provider-core/
  provider-openai/
  provider-deepseek/
  provider-anthropic/
  provider-gemini/
  provider-zhipu/
```

A monorepo is optional. For the first implementation, a single repository with clear modules is acceptable.

## 4. Provider abstraction

```ts
interface ProviderAdapter {
  id: string;
  getModels(ctx: ProviderContext): Promise<ModelInfo[]>;
  validateCredentials(ctx: ProviderContext): Promise<CredentialCheckResult>;
  chat(
    ctx: ProviderContext,
    request: NormalizedChatRequest
  ): AsyncIterable<NormalizedChatChunk>;
}
```

The adapter converts provider-specific protocols into normalized internal structures.

## 5. Internal request pipeline

```text
HTTP request
  -> authentication
  -> request validation
  -> model resolution
  -> routing policy
  -> provider adapter
  -> streaming normalization
  -> usage extraction
  -> cost calculation
  -> response stream
```

## 6. Failure model

Failures are classified:

- CLIENT_ERROR
- AUTH_ERROR
- RATE_LIMIT
- PROVIDER_UNAVAILABLE
- MODEL_NOT_FOUND
- REQUEST_REJECTED
- TIMEOUT
- STREAM_ERROR
- INTERNAL_ERROR

Only retry failures that are safe to retry.

## 7. Concurrency

Each request is independent.

The gateway must:

- avoid global mutable request state;
- preserve request correlation IDs;
- support concurrent streams;
- clean up aborted requests.

## 8. Port lifecycle

Default port: `8317`.

Startup:

1. Check configured port.
2. Bind to `127.0.0.1`.
3. Verify health.
4. Update UI status.

If occupied:

- show clear error;
- do not silently choose another port unless explicitly configured.

## 9. Configuration

Non-secret configuration may be stored in application data.

Secrets must use OS secure storage.

## 10. Extensibility

Adding a provider should require:

1. adapter;
2. provider metadata;
3. model normalization;
4. tests;
5. registration.

It should not require modifications across router/business logic.
