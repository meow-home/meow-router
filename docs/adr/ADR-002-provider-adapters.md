# ADR-002: Provider Adapter Architecture

## Status

Accepted

## Decision

External providers are isolated behind adapters implementing a common internal interface.

## Reasons

- providers use different APIs;
- protocol translation belongs at the boundary;
- routing should remain provider-neutral;
- new providers should be additive.

## Consequence

Some advanced provider-specific features may not map perfectly to the common API. Unsupported features must be reported explicitly.
