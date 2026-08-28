# Task Index

| ID | Task | Depends on |
|---|---|---|
| T001 | Bootstrap | - |
| T101 | Persistence | T001 |
| T103 | Secure Credentials | T001 |
| T201 | Provider Core | T101, T103 |
| T203 | OpenAI-Compatible Adapter | T201 |
| T204 | DeepSeek Adapter | T203 |
| T301 | Gateway Server | T201 |
| T304 | Chat Completions | T301, T204 |
| T305 | Streaming | T304 |
| T401 | Virtual Models | T304 |
| T501 | Usage & Cost | T305, T401 |
| T701 | Routing & Fallback | T501 |
| T801 | Security Audit | T701 |

## Rule

If a dependency is incomplete, do not mark the dependent task complete.
