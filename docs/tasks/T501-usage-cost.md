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

- [ ] successful requests record usage;
- [ ] failed requests record status;
- [ ] cost calculator has deterministic tests;
- [ ] dashboard totals are derived from persisted records.
