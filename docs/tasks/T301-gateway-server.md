# T301 — Gateway Server

## Goal

Implement a localhost HTTP gateway.

## Requirements

- bind to 127.0.0.1;
- default port 8317;
- graceful startup;
- graceful shutdown;
- health state;
- request ID.

## Acceptance criteria

- [x] `/health` returns OK;
- [x] server binds only to loopback;
- [x] occupied port produces a clear error;
- [x] shutdown closes active server resources;
- [x] startup/shutdown are covered by tests.
