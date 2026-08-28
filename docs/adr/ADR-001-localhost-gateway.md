# ADR-001: Localhost Gateway

## Status

Accepted

## Decision

Expose the AI gateway on `127.0.0.1:8317` by default.

## Reasons

- compatible with local coding agents;
- avoids cloud relay infrastructure;
- keeps prompts/responses local between agent and gateway;
- simple configuration;
- easy debugging.

## Rejected alternatives

### Remote gateway by default

Rejected because it increases attack surface and requires authentication/network security.

### Per-agent provider configuration

Rejected because it duplicates configuration and makes model switching difficult.

## Consequences

Users must keep Meow Gateway running while using the local endpoint.
