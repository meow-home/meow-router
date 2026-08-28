# T101 — Persistence Layer

## Goal

Implement SQLite persistence for non-secret application data.

## Scope

- database initialization;
- migrations;
- provider table;
- account table;
- model table;
- gateway config table.

## Acceptance criteria

- [ ] database is created in the platform application-data directory.
- [ ] migrations run automatically.
- [ ] migrations are idempotent.
- [ ] provider CRUD is tested.
- [ ] secrets are absent from database records.
- [ ] database errors are handled without crashing renderer.

## Out of scope

- cloud sync;
- analytics;
- request history beyond the schema required later.
