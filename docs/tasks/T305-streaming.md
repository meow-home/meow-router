# T305 — Streaming

## Goal

Support end-to-end SSE streaming.

## Requirements

- `stream=true`;
- chunk normalization;
- `[DONE]`;
- client disconnect detection;
- AbortSignal propagation;
- usage recording after stream completion.

## Acceptance criteria

- [ ] chunks arrive incrementally;
- [ ] stream closes cleanly;
- [ ] provider request is aborted after client disconnect when supported;
- [ ] partial streams do not create false successful usage records;
- [ ] stream errors use the documented error contract.
