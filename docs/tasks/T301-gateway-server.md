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

- [ ] `/health` returns OK;
- [ ] server binds only to loopback;
- [ ] occupied port produces a clear error;
- [ ] shutdown closes active server resources;
- [ ] startup/shutdown are covered by tests.
