# Local Gateway API

Base URL:

`http://127.0.0.1:8317/v1`

## Authentication

For localhost-only mode, API-key authentication is optional.

If enabled:

```http
Authorization: Bearer <local-gateway-key>
```

The local gateway key is independent from cloud provider API keys.

## GET /health

Returns:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "gateway": {
    "running": true
  }
}
```

## GET /v1/models

Returns OpenAI-compatible model objects.

```json
{
  "object": "list",
  "data": [
    {
      "id": "meow-coding",
      "object": "model",
      "owned_by": "meow-gateway"
    }
  ]
}
```

## POST /v1/chat/completions

Input should accept the common OpenAI chat completion subset:

- model
- messages
- temperature
- top_p
- max_tokens
- stream
- tools
- tool_choice
- response_format where supported

Example:

```json
{
  "model": "meow-coding",
  "messages": [
    {
      "role": "user",
      "content": "Explain this function."
    }
  ],
  "stream": true
}
```

## Streaming

Use Server-Sent Events.

Each chunk must be emitted as:

```text
data: {...}

```

Finish with:

```text
data: [DONE]

```

## Virtual model resolution

Example configuration:

```json
{
  "id": "meow-coding",
  "providerId": "deepseek",
  "providerModelId": "deepseek-chat"
}
```

The client only sees `meow-coding`.

## Error contract

Use OpenAI-compatible error structure where possible:

```json
{
  "error": {
    "message": "Provider authentication failed",
    "type": "authentication_error",
    "code": "PROVIDER_AUTH_FAILED"
  }
}
```

Never return provider secrets or upstream authorization headers.

## API compatibility strategy

MVP targets the common OpenAI Chat Completions contract.

Provider-specific capabilities are represented internally and may be rejected explicitly when unsupported rather than silently dropped.
