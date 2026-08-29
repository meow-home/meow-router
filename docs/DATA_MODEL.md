# Data Model

SQLite stores non-secret application data.

## Provider

```text
Provider
- id
- type
- display_name
- enabled
- base_url
- created_at
- updated_at
```

Credentials are referenced by a secure-store key, never stored in SQLite.

## Account

```text
Account
- id
- provider_id
- display_name
- credential_ref
- status
- created_at
- updated_at
```

Multiple accounts per provider are supported by the model even if the MVP UI initially exposes one account.

## Model

```text
Model
- id
- provider_id
- provider_model_id
- display_name
- context_window
- input_price
- output_price
- capabilities_json
- enabled
- discovered_at
```

## VirtualModel

```text
VirtualModel
- id
- display_name
- provider_id
- provider_model_id
- routing_policy_id nullable
- enabled
- created_at
- updated_at
```

## RoutingPolicy

```text
RoutingPolicy
- id
- name
- strategy
- config_json
```

## RequestUsage

```text
RequestUsage
- id
- request_id
- virtual_model_id
- provider_id
- provider_model_id
- input_tokens
- output_tokens
- cached_tokens
- estimated_cost
- latency_ms
- status
- error_code nullable
- error_message nullable
- route_attempt
- created_at
```

## GatewayConfig

```text
GatewayConfig
- id
- host
- port
- auth_enabled
- startup_enabled
```

## Migration rules

- Every schema change requires a migration.
- Never delete user data during startup migration.
- Migrations must be idempotent.
- Backup/export is a future feature, but destructive migrations are forbidden.
