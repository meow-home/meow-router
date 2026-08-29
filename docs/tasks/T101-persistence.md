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

- [x] database is created in the platform application-data directory.
- [x] migrations run automatically.
- [x] migrations are idempotent.
- [x] provider CRUD is tested.
- [x] secrets are absent from database records.
- [x] database errors are handled without crashing renderer.

## Out of scope

- cloud sync;
- analytics;
- request history beyond the schema required later.
