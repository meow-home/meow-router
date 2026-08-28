# Security Model

## Threat model

The app handles:

- cloud API credentials;
- user prompts/code;
- provider responses;
- local HTTP requests.

Primary risks:

1. Credential leakage.
2. Local unauthorized access.
3. malicious prompt content triggering unsafe logging/tool behavior;
4. renderer privilege escalation;
5. SSRF through custom provider URLs;
6. accidental sensitive request logging.

## Rules

### Credentials

Use OS secure credential storage.

Never:

- store raw API keys in SQLite;
- store raw API keys in localStorage;
- print keys in logs;
- include keys in error messages;
- send keys through renderer IPC payloads.

### Local server

Default:

`127.0.0.1`

Never bind publicly by default.

If remote binding is ever introduced, it must be an explicit opt-in with authentication and security warnings.

### SSRF

Custom provider URLs are security-sensitive.

Reject or warn on:

- localhost provider targets;
- private IP targets;
- link-local targets;
- metadata-service addresses;

unless an explicit advanced setting allows them.

### Logs

Default logs contain:

- request ID;
- provider;
- model;
- status;
- latency;
- token counts.

Do not log:

- Authorization header;
- API keys;
- complete prompts;
- complete model responses.

### Electron

- Use context isolation.
- Disable Node integration in renderer.
- Expose only a narrow preload API.
- Validate IPC payloads.
- Use CSP.
- Avoid arbitrary navigation.

### HTTP

- Limit body size.
- Validate JSON.
- Apply request timeout.
- Support AbortSignal.
- Sanitize error responses.

## Security acceptance tests

- API key never appears in renderer devtools state.
- API key never appears in database.
- API key never appears in default logs.
- Gateway cannot be reached through the machine's LAN interface in default configuration.
- Invalid IPC payloads are rejected.
