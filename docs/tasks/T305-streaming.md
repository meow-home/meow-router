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

- [x] chunks arrive incrementally;
- [x] stream closes cleanly;
- [x] provider request is aborted after client disconnect when supported;
- [x] partial streams do not create false successful usage records;
- [x] stream errors use the documented error contract.
