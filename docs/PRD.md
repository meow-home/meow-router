# Product Requirements Document

## 1. Product

**Name:** Meow Gateway  
**Type:** Desktop AI provider manager + local model gateway  
**Platforms:** Windows, macOS, Linux

## 2. Problem

Developers often use multiple AI providers and coding agents. Each agent has its own provider configuration, model naming, API-key management and sometimes incompatible API formats.

This causes:

- repeated API-key configuration;
- difficult model switching;
- provider-specific configuration;
- poor visibility into token/cost usage;
- difficult fallback handling;
- vendor lock-in at the agent configuration layer.

## 3. Product solution

Provide one local endpoint:

`http://127.0.0.1:8317/v1`

The agent talks to Meow Gateway. Meow Gateway handles provider authentication, model selection, protocol translation, routing, streaming, retries and usage tracking.

## 4. Personas

### Developer

Needs to switch between models quickly and avoid configuring every coding agent separately.

### Power user

Uses multiple providers, wants fallback/routing and cost visibility.

### Coding-agent developer

Needs a stable OpenAI-compatible endpoint for integration testing.

## 5. MVP capabilities

### Provider management

- Add provider.
- Remove provider.
- Enable/disable provider.
- Validate credentials.
- Test connectivity.
- Store credentials securely.
- Support custom endpoint where provider permits it.

### Model management

- Fetch provider model list.
- Refresh models.
- Show model metadata when available.
- Select active model.
- Map provider model IDs to user-friendly virtual model IDs.

### Gateway

- Start/stop local server.
- Configurable localhost port.
- `/v1/models`.
- `/v1/chat/completions`.
- Streaming SSE.
- OpenAI-compatible request/response shape.
- Provider adapter translation.
- Health endpoint.

### Observability

- Request count.
- Input/output tokens.
- Cached tokens when available.
- Estimated cost.
- Latency.
- Provider/model.
- Error count.

### Security

- OS credential store.
- Localhost-only default.
- Redaction.
- No secret persistence in renderer state.
- API key for gateway clients, optional in localhost-only mode.

## 6. Post-MVP

- Fallback policies.
- Smart routing.
- Per-client API keys.
- Budget limits.
- Rate limits.
- Request history.
- Export/import non-secret configuration.
- More provider adapters.
- OpenAI Responses compatibility.
- Anthropic Messages compatibility.
- Vision/tool-call normalization.

## 7. Success criteria

MVP is successful when a user can:

1. Install the desktop application.
2. Add a provider credential.
3. Fetch models.
4. Select a model.
5. Start the gateway.
6. Configure a coding agent with the localhost endpoint.
7. Send a streaming tool-capable chat request.
8. See token/cost/latency statistics.
9. Change the model without changing the coding agent configuration.

## 8. UX principles

- Technical, compact desktop UI.
- Dark-first interface.
- Clear gateway status.
- Provider health visible.
- Model selection takes no more than a few clicks.
- Never expose secrets unnecessarily.
- Errors should explain the actionable cause.
