# T801 — Security Audit

## Goal

Perform a release-blocking security review.

## Checklist

- [ ] Electron context isolation.
- [ ] Renderer has no Node integration.
- [ ] Narrow preload API.
- [ ] IPC validation.
- [ ] Credential storage review.
- [ ] Secret redaction.
- [ ] Localhost-only binding.
- [ ] SSRF protections for custom endpoints.
- [ ] HTTP body-size limits.
- [ ] Timeout limits.
- [ ] Request cancellation.
- [ ] No sensitive data in logs.
- [ ] Dependency audit.
- [ ] Packaged application review.

## Exit criterion

No unresolved critical/high security issue.
