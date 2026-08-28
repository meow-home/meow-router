# AI Coding Workflow

This document is intended to make the repository executable by an AI coding agent.

## Start command

Tell the coding agent:

> Read `AGENTS.md`, then read `docs/DEVELOPMENT_PLAN.md`. Inspect the repository and determine the first incomplete task. Implement only that task, run all relevant tests, and stop when its acceptance criteria are satisfied.

## Task selection

Use this order:

```text
T001
  -> T101
  -> T103
  -> T201
  -> T203
  -> T204
  -> T301
  -> T304
  -> T305
  -> T401
  -> T501
  -> T701
  -> T801
```

Parallel work is allowed only when tasks have no dependency conflict.

## Before coding

- inspect package.json;
- inspect existing source;
- inspect test setup;
- identify existing reusable utilities;
- do not overwrite existing architecture without evidence.

## During coding

- implement smallest complete vertical slice;
- add tests immediately;
- keep changes scoped;
- update docs if contracts changed.

## After coding

Run:

```bash
npm run typecheck
npm run lint
npm test
```

Then verify task acceptance criteria.

## Commit guidance

Prefer one logical commit per task when the user requests commits.

Suggested format:

```text
feat(gateway): implement chat completions
```

## Agent completion report

Return:

```text
Task:
Status:

Implemented:
- ...

Tests:
- ...

Files changed:
- ...

Risks:
- ...

Next task:
- ...
```
