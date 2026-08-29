# T401 — Virtual Models

## Goal

Let users expose stable local model names that map to provider models.

## Example

```text
meow-coding -> deepseek / deepseek-chat
```

## Requirements

- CRUD;
- validation;
- enable/disable;
- API exposure;
- model resolution.

## Acceptance criteria

- [x] `/v1/models` lists enabled virtual models;
- [x] chat request resolves virtual model;
- [x] changing mapping does not require changing client configuration;
- [x] invalid provider/model mapping is detected.
