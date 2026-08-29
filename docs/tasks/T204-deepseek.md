# T204 — DeepSeek Adapter

## Goal

Add DeepSeek using the provider adapter architecture.

## Requirements

- provider metadata;
- secure credential reference;
- model discovery;
- chat completion;
- streaming;
- usage extraction;
- error mapping.

## Acceptance criteria

- [x] adapter passes shared provider contract tests;
- [x] live provider test is optional and disabled by default;
- [x] no provider-specific logic leaks into gateway router.
