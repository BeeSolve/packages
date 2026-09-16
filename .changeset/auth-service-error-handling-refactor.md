---
"@beesolve/auth-service": patch
---

Internal error-handling cleanup with no public API change.

- `AuthError` now accepts `unknown` instead of `any` in its constructor.
- `Sessions.parseOne` / `parseOneFull` drop the optional `errorMessage`
  parameter and throw fixed `BadRequestError` messages instead.
