# Project Context

## Product identity

Meow Gateway is a companion desktop application for AI coding workflows.

It is not itself a coding agent.

The goal is to make provider/model configuration a shared local infrastructure layer for tools such as Meow Coding and other coding agents.

## Relationship with Meow Coding

Meow Coding already provides an agent-centric experience with tools, permissions, sessions, workflow skills, MCP/LSP, browser bridge and cost tracking.

Meow Gateway should remain independently useful and should communicate with Meow Coding through a standard local HTTP API.

Do not create a hard dependency on Meow Coding.

## Design philosophy

- provider-neutral;
- local-first;
- secure-by-default;
- OpenAI-compatible;
- observable;
- extensible;
- minimal configuration for coding agents.

## Key user story

A developer can change from one cloud model to another inside Meow Gateway without editing every coding-agent configuration.

## Future integration

Meow Coding may later include:

```text
Settings
  -> AI Gateway
      -> Connect to local Meow Gateway
      -> Select virtual model
```

That integration is outside the first MVP.
