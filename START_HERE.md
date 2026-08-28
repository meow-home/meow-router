# START HERE

## For an AI coding agent

Execute exactly this workflow:

1. Read `AGENTS.md`.
2. Read `docs/PRD.md`.
3. Read `docs/ARCHITECTURE.md`.
4. Read `docs/DEVELOPMENT_PLAN.md`.
5. Read `docs/TASK_INDEX.md`.
6. Inspect the current repository.
7. Find the first incomplete task.
8. Read that task file.
9. Implement only the task and required tests.
10. Run typecheck, lint and tests.
11. Verify every acceptance criterion.
12. Update documentation if contracts changed.
13. Report the result and identify the next task.

Do not implement future phases speculatively.

## Suggested first prompt

```text
You are the lead engineer for this repository.

Read START_HERE.md and AGENTS.md first.
Then inspect the repository and execute the first incomplete task from docs/TASK_INDEX.md.

Do not skip tasks.
Do not rewrite unrelated code.
Implement the smallest production-quality vertical slice.
Add tests.
Run typecheck, lint and tests.
Verify the task acceptance criteria.
At the end, report:
- implemented features
- files changed
- tests run
- acceptance criteria status
- risks
- next task
```
