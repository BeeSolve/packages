---
"@beesolve/auth-service": minor
---

Refactor `Accounts.getOne` to a props object and tidy internal error handling.

- **`Accounts.getOne` now takes a single props object**: `getOne({ username, exact })` instead of `getOne(username, { exact })`. The `exact` flag remains optional and defaults to `false`.
- `Sessions.fetchMany` now validates its DynamoDB result with a Valibot schema instead of an unchecked type assertion.
- `AuthError` accepts `unknown` instead of `any` in its constructor.
- `Sessions.parseOne` / `parseOneFull` drop the optional `errorMessage` parameter and throw fixed `BadRequestError` messages.

BREAKING: `Accounts.getOne(username, options)` callers must migrate to `Accounts.getOne({ username, exact })`.
