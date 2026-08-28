# UX Specification

## Navigation

Primary navigation:

```text
Dashboard
Providers
Models
Gateway
Usage
Settings
```

## Dashboard

Show:

- Gateway status.
- Endpoint.
- Active virtual model.
- Provider health.
- Requests today.
- Cost today.
- Recent errors.

## Providers

Each provider card:

```text
Provider name
Connection status
Account
Models
Last checked
[Connect] [Test] [Settings]
```

## Models

Two concepts must be visually distinct:

- Provider Model: actual upstream model.
- Virtual Model: stable local name exposed to agents.

## Gateway

Show:

- Running/stopped.
- Host.
- Port.
- Base URL.
- Authentication state.
- Start/stop.
- Copy endpoint.

## Usage

Filters:

- date;
- provider;
- model;
- status.

Metrics:

- requests;
- input tokens;
- output tokens;
- cached tokens;
- estimated cost;
- average latency.

## Error UX

Errors should answer:

1. What happened?
2. Why?
3. What can I do?

Never show raw stack traces by default.
