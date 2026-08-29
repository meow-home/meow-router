# T501 — Usage & Cost

## Goal

Track request usage and estimate cost.

## Requirements

Record:

- request ID;
- provider;
- model;
- input tokens;
- output tokens;
- cached tokens if available;
- latency;
- status;
- estimated cost;
- timestamp.

## Cost rules

- Pricing must be data/configuration, not hard-coded in business logic.
- Unknown pricing must produce `null`/`unknown`, not a fabricated number.
- Cached input pricing must be represented separately when provider data supports it.

## Acceptance criteria

- [x] successful requests record usage;
- [x] failed requests record status;
- [x] cost calculator has deterministic tests;
- [x] dashboard totals are derived from persisted records.
